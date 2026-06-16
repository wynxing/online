use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

use crate::models::RuntimeConfig;

/// nnnoiseless processes audio in frames of 480 samples (10 ms at 48 kHz).
const DENOISE_FRAME_SIZE: usize = 480;

/// Target peak amplitude for normalization (73% of i16 max).
const TARGET_PEAK: i32 = 24_000;

/// Minimum peak to trigger normalization. Avoids amplifying near-silent audio.
const MIN_PEAK: i32 = 2_000;

/// Minimum gain factor (prevents extreme attenuation).
const MIN_GAIN: f32 = 0.1;

/// Maximum gain factor (+12 dB cap to prevent noise amplification).
const MAX_GAIN: f32 = 4.0;

/// Persistent audio preprocessor that maintains RNN denoise state across frames.
///
/// The denoise state must persist for cross-frame context (RNN temporal modeling).
/// The rubato resampler is created per-call (sinc filter table setup is cheap
/// relative to the benefit of correct single-pass processing for variable-length
/// streaming frames). Call [`reset`](Self::reset) when the input format changes.
pub struct AudioPreprocessor {
    denoise_state: Option<Box<nnnoiseless::DenoiseState<'static>>>,
    denoise_warned: bool,
}

impl AudioPreprocessor {
    pub fn new() -> Self {
        Self {
            denoise_state: Some(nnnoiseless::DenoiseState::new()),
            denoise_warned: false,
        }
    }

    /// Process a raw audio frame through the full preprocessing chain:
    ///
    /// 1. Denoise (48 kHz only, using persistent RNN state)
    /// 2. Mono downmix (if multi-channel)
    /// 3. Resample to 16 kHz (rubato sinc interpolation)
    ///
    /// Returns preprocessed mono 16 kHz i16 samples.
    pub fn process(
        &mut self,
        samples: &[i16],
        sample_rate: u32,
        channels: u16,
        config: &RuntimeConfig,
    ) -> Vec<i16> {
        // 1. Denoise at 48 kHz using persistent RNN state.
        let denoised = if config.audio_denoise_enabled {
            if sample_rate == 48_000 {
                match &mut self.denoise_state {
                    Some(state) => denoise_with_state(samples, state),
                    None => samples.to_vec(),
                }
            } else {
                if !self.denoise_warned {
                    tracing::warn!(
                        "Denoise requires 48 kHz input (got {sample_rate} Hz), skipping"
                    );
                    self.denoise_warned = true;
                }
                samples.to_vec()
            }
        } else {
            samples.to_vec()
        };

        // 2. Mono downmix if multi-channel.
        let mono: Vec<i16> = if channels == 1 {
            denoised
        } else {
            denoised
                .chunks(channels as usize)
                .map(|ch| {
                    let sum: i32 = ch.iter().map(|s| *s as i32).sum();
                    (sum / channels as i32) as i16
                })
                .collect()
        };

        // 3. Resample to 16 kHz using rubato sinc interpolation.
        resample_to_16k_rubato(&mono, sample_rate, &config.audio_resample_quality)
    }

    /// Reset internal state. Call when the input format changes
    /// (sample rate, channel count) to start with fresh DSP context.
    pub fn reset(&mut self) {
        self.denoise_state = Some(nnnoiseless::DenoiseState::new());
        self.denoise_warned = false;
    }
}

/// Denoise i16 audio using a persistent `DenoiseState`.
///
/// nnnoiseless expects f32 values in the **i16 amplitude range**
/// [-32768.0, 32767.0], NOT normalized [-1.0, 1.0].
/// Processes in 480-sample frames; leftover samples (< 480) are
/// passed through unmodified.
fn denoise_with_state(samples: &[i16], state: &mut nnnoiseless::DenoiseState) -> Vec<i16> {
    if samples.len() < DENOISE_FRAME_SIZE {
        return samples.to_vec();
    }

    let mut input = [0.0f32; DENOISE_FRAME_SIZE];
    let mut output = [0.0f32; DENOISE_FRAME_SIZE];
    let mut result = Vec::with_capacity(samples.len());

    let full_frames = samples.len() / DENOISE_FRAME_SIZE;
    for i in 0..full_frames {
        let start = i * DENOISE_FRAME_SIZE;
        let frame = &samples[start..start + DENOISE_FRAME_SIZE];
        // nnnoiseless expects i16-range f32 values, not [-1, 1].
        for (j, &s) in frame.iter().enumerate() {
            input[j] = s as f32;
        }
        state.process_frame(&mut output, &input);
        for &s in &output {
            result.push(s.clamp(-32768.0, 32767.0) as i16);
        }
    }

    // Append remaining samples unprocessed.
    let tail_start = full_frames * DENOISE_FRAME_SIZE;
    if tail_start < samples.len() {
        result.extend_from_slice(&samples[tail_start..]);
    }

    result
}

/// Resample mono i16 audio to 16 kHz using rubato's sinc interpolation.
///
/// Creates a new `SincFixedIn` each call with `chunk_size` equal to the input
/// length, which ensures correct single-pass processing for streaming frames.
/// Falls back to nearest-neighbor if rubato initialization fails.
fn resample_to_16k_rubato(samples: &[i16], src_rate: u32, quality: &str) -> Vec<i16> {
    if src_rate == 16_000 || samples.is_empty() || src_rate == 0 {
        return samples.to_vec();
    }

    match try_resample_rubato(samples, src_rate, quality) {
        Some(resampled) => resampled,
        None => {
            tracing::warn!("rubato resample failed, falling back to nearest-neighbor");
            resample_nearest(samples, src_rate)
        }
    }
}

fn try_resample_rubato(samples: &[i16], src_rate: u32, quality: &str) -> Option<Vec<i16>> {
    let ratio = 16_000.0 / src_rate as f64;

    let params = if quality == "high" {
        SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        }
    } else {
        // "fast" — lower quality settings for speed.
        SincInterpolationParameters {
            sinc_len: 64,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 128,
            window: WindowFunction::BlackmanHarris2,
        }
    };

    // Convert to f32 normalized [-1, 1] for rubato.
    let input_f32: Vec<f32> = samples.iter().map(|&s| s as f32 / 32768.0).collect();

    // chunk_size must equal the actual input length for single-pass processing.
    let chunk_size = input_f32.len();

    let mut resampler = SincFixedIn::<f32>::new(ratio, 2.0, params, chunk_size, 1).ok()?;
    let out = resampler.process(&[input_f32], None).ok()?;
    let resampled_f32: Vec<f32> = out.into_iter().flatten().collect();

    Some(
        resampled_f32
            .iter()
            .map(|&s| (s * 32768.0).clamp(-32768.0, 32767.0) as i16)
            .collect(),
    )
}

/// Peak-normalize i16 audio to a target amplitude level.
///
/// Intended for use on a **complete segment** (not per-frame) to avoid
/// pumping artifacts from gain discontinuities between adjacent frames.
///
/// - If the segment peak is below `MIN_PEAK`, treat as silence and skip.
/// - Gain is clamped to `[MIN_GAIN, MAX_GAIN]` to prevent extreme
///   amplification of quiet segments or over-attenuation.
pub fn peak_normalize(samples: &[i16]) -> Vec<i16> {
    let max_amp = samples
        .iter()
        .map(|&s| (s as i32).unsigned_abs())
        .max()
        .unwrap_or(0);

    if max_amp < MIN_PEAK as u32 {
        return samples.to_vec();
    }

    let gain = TARGET_PEAK as f32 / max_amp as f32;
    let gain = gain.clamp(MIN_GAIN, MAX_GAIN);

    // Skip normalization if gain is ~1.0 (already at target level).
    if (gain - 1.0).abs() < 0.05 {
        return samples.to_vec();
    }

    samples
        .iter()
        .map(|&s| ((s as f32 * gain).round() as i32).clamp(-32768, 32767) as i16)
        .collect()
}

/// Fallback nearest-neighbor resampling.
fn resample_nearest(samples: &[i16], src_rate: u32) -> Vec<i16> {
    let ratio = src_rate as f64 / 16_000.0;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos as usize;
        if idx < samples.len() {
            out.push(samples[idx]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: create a RuntimeConfig with default audio settings.
    fn test_config() -> RuntimeConfig {
        RuntimeConfig::default()
    }

    // --- AudioPreprocessor tests ---

    #[test]
    fn preprocessor_denoise_skips_non_48k() {
        let mut pp = AudioPreprocessor::new();
        let samples: Vec<i16> = (0..1000).map(|i| (i % 256) as i16).collect();
        let mut config = test_config();
        config.audio_denoise_enabled = true;
        let result = pp.process(&samples, 44_100, 1, &config);
        // Denoise skipped, mono passthrough, nearest-neighbor resample.
        // Output should be shorter than input (44.1k → 16k).
        assert!(result.len() < samples.len());
    }

    #[test]
    fn preprocessor_denoise_at_48k() {
        let mut pp = AudioPreprocessor::new();
        let samples: Vec<i16> = vec![1000; DENOISE_FRAME_SIZE * 2];
        let config = test_config();
        let result = pp.process(&samples, 48_000, 1, &config);
        // 48k → 16k resample: output ~1/3 length.
        assert!(
            result.len() > 0 && result.len() < samples.len(),
            "expected resampled output, got {} samples",
            result.len()
        );
    }

    #[test]
    fn preprocessor_denoise_short_input() {
        let mut pp = AudioPreprocessor::new();
        let samples: Vec<i16> = vec![100; 100];
        let config = test_config();
        let result = pp.process(&samples, 48_000, 1, &config);
        // Short input passed through denoise, then resampled.
        assert!(result.len() > 0);
    }

    #[test]
    fn preprocessor_mono_downmix() {
        let mut pp = AudioPreprocessor::new();
        // Stereo input: alternating L/R.
        let stereo: Vec<i16> = (0..200)
            .map(|i| if i % 2 == 0 { 4000 } else { 2000 })
            .collect();
        let config = test_config();
        let result = pp.process(&stereo, 48_000, 2, &config);
        // Output should be mono + resampled.
        assert!(result.len() > 0);
    }

    #[test]
    fn preprocessor_reset_clears_state() {
        let mut pp = AudioPreprocessor::new();
        let samples: Vec<i16> = vec![1000; DENOISE_FRAME_SIZE];
        let config = test_config();
        let _ = pp.process(&samples, 48_000, 1, &config);
        pp.reset();
        // After reset, denoise_state should be fresh (Some).
        assert!(pp.denoise_state.is_some());
        assert!(!pp.denoise_warned);
    }

    #[test]
    fn preprocessor_resample_identity_at_16k() {
        let mut pp = AudioPreprocessor::new();
        let samples: Vec<i16> = (0..160).map(|i| i as i16).collect();
        let config = test_config();
        let result = pp.process(&samples, 16_000, 1, &config);
        // Already 16 kHz mono — passthrough.
        assert_eq!(result, samples);
    }

    // --- denoise_with_state tests ---

    #[test]
    fn denoise_processes_full_frames() {
        let mut state = nnnoiseless::DenoiseState::new();
        let samples: Vec<i16> = vec![1000; DENOISE_FRAME_SIZE * 2];
        let result = denoise_with_state(&samples, &mut state);
        assert_eq!(result.len(), samples.len());
    }

    #[test]
    fn denoise_preserves_tail() {
        let mut state = nnnoiseless::DenoiseState::new();
        let len = DENOISE_FRAME_SIZE + 100;
        let samples: Vec<i16> = vec![1000; len];
        let result = denoise_with_state(&samples, &mut state);
        assert_eq!(result.len(), len);
    }

    #[test]
    fn denoise_short_input_passthrough() {
        let mut state = nnnoiseless::DenoiseState::new();
        let samples: Vec<i16> = vec![100; 100];
        let result = denoise_with_state(&samples, &mut state);
        assert_eq!(result, samples);
    }

    // --- peak_normalize tests ---

    #[test]
    fn peak_normalize_amplifies_quiet() {
        let samples: Vec<i16> = vec![8_000; 1000];
        let result = peak_normalize(&samples);
        let max = result.iter().map(|&s| (s as i32).abs()).max().unwrap();
        assert_eq!(max, 24_000); // 8000 * 3.0
    }

    #[test]
    fn peak_normalize_skips_silence() {
        let samples: Vec<i16> = vec![10; 1000];
        let result = peak_normalize(&samples);
        assert_eq!(result, samples);
    }

    #[test]
    fn peak_normalize_noop_at_target() {
        let mut samples = vec![0i16; 1000];
        samples[500] = 23_000;
        samples[501] = -23_000;
        let result = peak_normalize(&samples);
        assert_eq!(result, samples);
    }

    #[test]
    fn peak_normalize_attenuates_clipping() {
        let samples: Vec<i16> = vec![30_000; 100];
        let result = peak_normalize(&samples);
        let max = result.iter().map(|&s| (s as i32).abs()).max().unwrap();
        assert_eq!(max, 24_000);
    }

    // --- resample tests ---

    #[test]
    fn resample_48k_to_16k_length() {
        let mut pp = AudioPreprocessor::new();
        let samples: Vec<i16> = vec![1000; 4800];
        let config = test_config();
        let result = pp.process(&samples, 48_000, 1, &config);
        let out_len = result.len();
        // Sinc resampler has latency; allow 5% tolerance.
        assert!(
            (1520..=1680).contains(&out_len),
            "expected ~1600 samples, got {out_len}"
        );
    }

    #[test]
    fn resample_nearest_fallback_works() {
        let samples: Vec<i16> = (0..480).map(|i| i as i16).collect();
        let result = resample_nearest(&samples, 48_000);
        assert_eq!(result.len(), 160);
    }
}
