"""Tests for ASR provider audio preprocessing."""

import numpy as np

from app.asr_provider import prepare_for_asr


def _make_pcm_mono(samples: list[int], sample_rate: int = 16000) -> bytes:
    """Create mono 16-bit PCM bytes from sample values."""
    return np.array(samples, dtype=np.int16).tobytes()


def _make_pcm_stereo(interleaved: list[int], sample_rate: int = 48000) -> bytes:
    """Create stereo 16-bit PCM bytes from interleaved L/R samples."""
    return np.array(interleaved, dtype=np.int16).tobytes()


class TestPrepareForAsr:
    """Tests for prepare_for_asr conversion function."""

    def test_mono_16k_passthrough(self):
        """Already mono 16kHz — no conversion needed."""
        pcm = _make_pcm_mono([100, -200, 300, -400])
        result, channels, rate = prepare_for_asr(pcm, channels=1, sample_rate=16000)
        assert result == pcm
        assert channels == 1
        assert rate == 16000

    def test_stereo_to_mono(self):
        """Stereo 16kHz → mono 16kHz (no resampling)."""
        # L=100, R=300 → avg=200; L=-200, R=-400 → avg=-300
        pcm = _make_pcm_stereo([100, 300, -200, -400])
        result, channels, rate = prepare_for_asr(pcm, channels=2, sample_rate=16000)
        samples = np.frombuffer(result, dtype=np.int16)
        assert channels == 1
        assert rate == 16000
        np.testing.assert_array_equal(samples, [200, -300])

    def test_stereo_48k_to_mono_16k(self):
        """Stereo 48kHz → mono 16kHz (both conversions)."""
        # 6 samples stereo = 3 frames at 48kHz → 1 frame at 16kHz
        pcm = _make_pcm_stereo([100, 100, 200, 200, 300, 300])
        result, channels, rate = prepare_for_asr(pcm, channels=2, sample_rate=48000)
        samples = np.frombuffer(result, dtype=np.int16)
        assert channels == 1
        assert rate == 16000
        # After mono: [100, 200, 300], after 3:1 decimation with avg filter
        assert len(samples) == 1

    def test_downsample_48k_to_16k(self):
        """Mono 48kHz → mono 16kHz (resampling only)."""
        # 9 samples at 48kHz → 3 samples at 16kHz
        pcm = _make_pcm_mono([100, 200, 300, 400, 500, 600, 700, 800, 900])
        result, channels, rate = prepare_for_asr(pcm, channels=1, sample_rate=48000)
        samples = np.frombuffer(result, dtype=np.int16)
        assert channels == 1
        assert rate == 16000
        assert len(samples) == 3

    def test_target_rate_zero_disables_resampling(self):
        """target_rate=0 disables resampling but still does stereo→mono."""
        pcm = _make_pcm_stereo([100, 300, -200, -400])
        result, channels, rate = prepare_for_asr(pcm, channels=2, sample_rate=48000, target_rate=0)
        samples = np.frombuffer(result, dtype=np.int16)
        assert channels == 1
        assert rate == 48000  # sample rate unchanged
        np.testing.assert_array_equal(samples, [200, -300])

    def test_empty_audio(self):
        """Empty PCM data returns empty output."""
        result, channels, rate = prepare_for_asr(b"", channels=2, sample_rate=48000)
        assert result == b""
        assert channels == 2
        assert rate == 48000

    def test_short_stereo_stays_stereo(self):
        """Stereo data with only 1 sample (< 4 bytes) stays stereo."""
        pcm = np.array([100], dtype=np.int16).tobytes()
        result, channels, rate = prepare_for_asr(pcm, channels=2, sample_rate=48000)
        assert channels == 2  # too short to reshape as stereo

    def test_output_is_valid_pcm(self):
        """Output PCM bytes can be decoded back to int16 samples."""
        pcm = _make_pcm_mono([1000, -2000, 3000, -4000, 5000, -6000])
        result, channels, rate = prepare_for_asr(pcm, channels=1, sample_rate=48000)
        samples = np.frombuffer(result, dtype=np.int16)
        assert len(samples) > 0
        assert all(isinstance(s, (int, np.int16)) for s in samples)
