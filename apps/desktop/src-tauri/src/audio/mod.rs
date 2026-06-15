use std::collections::HashMap;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    models::Device,
};

const LEGACY_SYSTEM_LOOPBACK_ID: &str = "system_loopback";
const LEGACY_DEFAULT_MIC_ID: &str = "default_microphone";

#[derive(Debug, Clone)]
pub struct AudioFrame {
    pub samples: Vec<i16>,
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone)]
pub struct CaptureDevice {
    pub id: String,
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub backend: AudioBackendKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioBackendKind {
    CpalInput,
    #[cfg(windows)]
    WasapiLoopback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AudioDeviceInfo {
    id: String,
    name: String,
    kind: DeviceKind,
    index: usize,
    sample_rate: u32,
    channels: u16,
    description: Option<String>,
    is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeviceKind {
    System,
    Microphone,
}

impl DeviceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Microphone => "microphone",
        }
    }
}

pub fn list_devices() -> Vec<Device> {
    devices_to_models(list_audio_device_infos())
}

fn list_audio_device_infos() -> Vec<AudioDeviceInfo> {
    #[cfg(windows)]
    {
        match wasapi::list_devices() {
            Ok(devices) if !devices.is_empty() => return devices,
            Ok(_) => {}
            Err(error) => tracing::warn!("WASAPI device enumeration failed: {error}"),
        }
    }

    list_cpal_input_devices()
}

fn devices_to_models(devices: Vec<AudioDeviceInfo>) -> Vec<Device> {
    let mut name_counts = HashMap::new();
    for device in &devices {
        *name_counts
            .entry(device_duplicate_key(device))
            .or_insert(0usize) += 1;
    }

    devices
        .into_iter()
        .map(|device| {
            let duplicate_name = name_counts
                .get(&device_duplicate_key(&device))
                .copied()
                .unwrap_or_default()
                > 1;
            device_to_model(device, duplicate_name)
        })
        .collect()
}

fn device_to_model(device: AudioDeviceInfo, duplicate_name: bool) -> Device {
    let display_name = device_display_name(&device, duplicate_name);
    Device {
        id: device.id,
        name: device.name,
        display_name: Some(display_name),
        kind: device.kind.as_str().into(),
        is_default: device.is_default,
        available: true,
        description: device.description,
    }
}

fn device_display_name(device: &AudioDeviceInfo, duplicate_name: bool) -> String {
    let mut label = format!(
        "{} - {}",
        device_kind_label(device.kind),
        device.name.trim()
    );
    if device.is_default {
        label.push_str(" (Default)");
    }
    if duplicate_name {
        label.push_str(&format!(" [{}]", short_device_id(&device.id)));
    }
    label
}

fn device_kind_label(kind: DeviceKind) -> &'static str {
    match kind {
        DeviceKind::System => "System audio",
        DeviceKind::Microphone => "Microphone",
    }
}

fn device_duplicate_key(device: &AudioDeviceInfo) -> String {
    format!("{}|{}", device.kind.as_str(), device.name.to_lowercase())
}

fn short_device_id(device_id: &str) -> &str {
    device_id
        .rsplit(['\\', '#', '.'])
        .next()
        .unwrap_or(device_id)
}

pub fn capture_blocking(
    device_id: String,
    tx: mpsc::Sender<AudioFrame>,
    token: CancellationToken,
) -> AppResult<CaptureDevice> {
    let info = resolve_device_info(&device_id)?;
    tracing::info!(
        "Starting audio capture: id={} name={} rate={} channels={} backend={:?}",
        info.id,
        info.name,
        info.sample_rate,
        info.channels,
        info.backend
    );

    match info.backend {
        AudioBackendKind::CpalInput => capture_cpal_input(info, tx, token),
        #[cfg(windows)]
        AudioBackendKind::WasapiLoopback => wasapi::capture_loopback(info, tx, token),
    }
}

fn resolve_device_info(device_id: &str) -> AppResult<CaptureDevice> {
    let devices = list_audio_device_infos();
    let selected = resolve_device_id(device_id, &devices)
        .ok_or_else(|| AppError::Audio(format!("AUDIO_DEVICE_INVALID: {device_id}")))?;
    let backend = if selected.id.starts_with("input_")
        || selected.id.starts_with("coreaudio_input_")
        || selected.id.starts_with("coreaudio_virtual_")
        || selected.id.starts_with("pulse_monitor_")
        || selected.id.starts_with("portaudio_input_")
    {
        AudioBackendKind::CpalInput
    } else {
        #[cfg(windows)]
        {
            if selected.id.starts_with("wasapi_loopback_") {
                AudioBackendKind::WasapiLoopback
            } else {
                AudioBackendKind::CpalInput
            }
        }
        #[cfg(not(windows))]
        {
            AudioBackendKind::CpalInput
        }
    };

    Ok(CaptureDevice {
        id: selected.id,
        name: selected.name,
        sample_rate: selected.sample_rate,
        channels: selected.channels,
        backend,
    })
}

fn resolve_device_id(device_id: &str, devices: &[AudioDeviceInfo]) -> Option<AudioDeviceInfo> {
    if let Some(device) = devices.iter().find(|device| device.id == device_id) {
        return Some(device.clone());
    }

    if device_id.is_empty() || device_id == LEGACY_SYSTEM_LOOPBACK_ID {
        return devices
            .iter()
            .find(|device| device.kind == DeviceKind::System)
            .or_else(|| devices.first())
            .cloned();
    }

    if device_id == LEGACY_DEFAULT_MIC_ID {
        return devices
            .iter()
            .find(|device| device.kind == DeviceKind::Microphone)
            .or_else(|| devices.first())
            .cloned();
    }

    None
}

fn list_cpal_input_devices() -> Vec<AudioDeviceInfo> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|device| device.name().ok());

    let Ok(inputs) = host.input_devices() else {
        return Vec::new();
    };

    let mut devices = Vec::new();
    for (index, device) in inputs.enumerate() {
        let Ok(name) = device.name() else { continue };
        let Ok(config) = device.default_input_config() else {
            continue;
        };
        let kind = classify_input_device(&name, std::env::consts::OS);
        devices.push(AudioDeviceInfo {
            id: cpal_device_id(index, kind, std::env::consts::OS),
            name,
            kind,
            index,
            sample_rate: config.sample_rate().0,
            channels: config.channels().min(2),
            description: cpal_description(kind, std::env::consts::OS),
            is_default: false,
        });
    }

    order_devices(devices, default_name.as_deref())
}

fn cpal_device_id(index: usize, kind: DeviceKind, os: &str) -> String {
    match (os, kind) {
        ("macos", DeviceKind::System) => format!("coreaudio_virtual_{index}"),
        ("macos", DeviceKind::Microphone) => format!("coreaudio_input_{index}"),
        ("linux", DeviceKind::System) => format!("pulse_monitor_{index}"),
        ("linux", DeviceKind::Microphone) => format!("portaudio_input_{index}"),
        _ => format!("input_{index}"),
    }
}

fn cpal_description(kind: DeviceKind, os: &str) -> Option<String> {
    match (os, kind) {
        ("macos", DeviceKind::System) => {
            Some("macOS virtual audio input for system audio capture.".into())
        }
        ("macos", DeviceKind::Microphone) => Some("macOS microphone/input device.".into()),
        ("linux", DeviceKind::System) => {
            Some("Linux PulseAudio/PipeWire monitor source for system audio capture.".into())
        }
        ("linux", DeviceKind::Microphone) => Some("Linux microphone/input device.".into()),
        (_, DeviceKind::System) => Some("System audio input source.".into()),
        (_, DeviceKind::Microphone) => Some("Microphone input source.".into()),
    }
}

fn classify_input_device(name: &str, os: &str) -> DeviceKind {
    let lower = name.to_lowercase();
    let system_tokens = [
        "vb-audio",
        "voicemeeter",
        "cable",
        "virtual",
        "blackhole",
        "soundflower",
        "jack",
        "loopback",
        "ocean audio",
        "stereo mix",
        "wave out",
        "what u hear",
        "what-u-hear",
        "mixage stereo",
        "mixage stéréo",
    ];

    if system_tokens.iter().any(|token| lower.contains(token)) {
        return DeviceKind::System;
    }
    if os == "linux" && lower.contains("monitor") {
        return DeviceKind::System;
    }
    DeviceKind::Microphone
}

fn order_devices(
    mut devices: Vec<AudioDeviceInfo>,
    default_name: Option<&str>,
) -> Vec<AudioDeviceInfo> {
    devices.sort_by_key(|device| match device.kind {
        DeviceKind::System => 0,
        DeviceKind::Microphone => 1,
    });
    for device in &mut devices {
        device.is_default = false;
    }
    if let Some(default_name) = default_name {
        if let Some(device) = devices
            .iter_mut()
            .find(|device| device.name == default_name)
        {
            device.is_default = true;
        }
    }
    if !devices.iter().any(|device| device.is_default) {
        if let Some(first) = devices.first_mut() {
            first.is_default = true;
        }
    }
    devices
}

fn capture_cpal_input(
    info: CaptureDevice,
    tx: mpsc::Sender<AudioFrame>,
    token: CancellationToken,
) -> AppResult<CaptureDevice> {
    let host = cpal::default_host();
    let index = parse_trailing_index(&info.id)
        .ok_or_else(|| AppError::Audio(format!("AUDIO_DEVICE_INVALID: {}", info.id)))?;
    let device = host
        .input_devices()
        .map_err(|e| AppError::Audio(e.to_string()))?
        .nth(index)
        .ok_or_else(|| AppError::Audio(format!("Audio device not found: {}", info.id)))?;
    let supported = device
        .default_input_config()
        .map_err(|e| AppError::Audio(e.to_string()))?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let err_fn = |err| tracing::warn!("audio stream error: {err}");

    let stream = match sample_format {
        cpal::SampleFormat::I16 => {
            build_input_stream::<i16>(&device, &config, tx, sample_rate, channels, err_fn)?
        }
        cpal::SampleFormat::U16 => {
            build_input_stream::<u16>(&device, &config, tx, sample_rate, channels, err_fn)?
        }
        cpal::SampleFormat::F32 => {
            build_input_stream::<f32>(&device, &config, tx, sample_rate, channels, err_fn)?
        }
        other => {
            return Err(AppError::Audio(format!(
                "Unsupported audio sample format: {other:?}"
            )))
        }
    };

    stream.play().map_err(|e| AppError::Audio(e.to_string()))?;
    while !token.is_cancelled() {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    drop(stream);
    Ok(info)
}

fn build_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    tx: mpsc::Sender<AudioFrame>,
    sample_rate: u32,
    channels: u16,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> AppResult<cpal::Stream>
where
    T: cpal::Sample + cpal::SizedSample + Send + 'static,
    i16: FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let samples = data.iter().copied().map(i16::from_sample).collect();
                let _ = tx.try_send(AudioFrame {
                    samples,
                    sample_rate,
                    channels,
                });
            },
            err_fn,
            None,
        )
        .map_err(|e| AppError::Audio(e.to_string()))
}

fn parse_trailing_index(device_id: &str) -> Option<usize> {
    device_id.rsplit('_').next()?.parse().ok()
}

trait FromSample<T> {
    fn from_sample(value: T) -> i16;
}

impl FromSample<i16> for i16 {
    fn from_sample(value: i16) -> i16 {
        value
    }
}

impl FromSample<u16> for i16 {
    fn from_sample(value: u16) -> i16 {
        (value as i32 - 32768) as i16
    }
}

impl FromSample<f32> for i16 {
    fn from_sample(value: f32) -> i16 {
        (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
    }
}

#[cfg(windows)]
mod wasapi {
    use super::*;
    use std::{ffi::c_void, slice};

    use windows::{
        core::GUID,
        Win32::{
            Foundation::E_POINTER,
            Media::{
                Audio::{
                    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice,
                    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX,
                    WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
                },
                KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE},
                Multimedia::{KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT},
            },
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
                COINIT_MULTITHREADED, STGM_READ,
            },
            UI::Shell::PropertiesSystem::{PSFormatForDisplayAlloc, PDFF_DEFAULT, PROPERTYKEY},
        },
    };

    const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    struct ComApartment {
        initialized: bool,
    }

    impl ComApartment {
        fn new() -> AppResult<Self> {
            let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            Ok(Self {
                initialized: result.is_ok(),
            })
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            if self.initialized {
                unsafe { CoUninitialize() };
            }
        }
    }

    struct WaveFormat(*mut WAVEFORMATEX);

    impl WaveFormat {
        fn as_ref(&self) -> AppResult<&WAVEFORMATEX> {
            unsafe {
                self.0
                    .as_ref()
                    .ok_or_else(|| AppError::Audio("WASAPI returned a null mix format.".into()))
            }
        }
    }

    impl Drop for WaveFormat {
        fn drop(&mut self) {
            unsafe { CoTaskMemFree(Some(self.0 as *const c_void)) };
        }
    }

    pub fn list_devices() -> AppResult<Vec<AudioDeviceInfo>> {
        let _com = ComApartment::new()?;
        let enumerator = device_enumerator()?;
        let default_render =
            endpoint_id(&unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok() });
        let default_capture =
            endpoint_id(&unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eConsole).ok() });

        let mut devices = Vec::new();
        devices.extend(enumerate_endpoints(
            &enumerator,
            eRender,
            "wasapi_loopback",
            DeviceKind::System,
            default_render.as_deref(),
        )?);
        devices.extend(enumerate_endpoints(
            &enumerator,
            eCapture,
            "wasapi_mic",
            DeviceKind::Microphone,
            default_capture.as_deref(),
        )?);

        if !devices.iter().any(|device| device.is_default) {
            if let Some(first) = devices.first_mut() {
                first.is_default = true;
            }
        }
        Ok(devices)
    }

    pub fn capture_loopback(
        info: CaptureDevice,
        tx: mpsc::Sender<AudioFrame>,
        token: CancellationToken,
    ) -> AppResult<CaptureDevice> {
        let _com = ComApartment::new()?;
        let enumerator = device_enumerator()?;
        let device = endpoint_by_index(&enumerator, eRender, info.id.as_str())?;
        let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|e| AppError::Audio(format!("WASAPI Activate failed: {e}")))?;
        let mix_format = WaveFormat(
            unsafe { client.GetMixFormat() }
                .map_err(|e| AppError::Audio(format!("WASAPI GetMixFormat failed: {e}")))?,
        );
        let format = mix_format.as_ref()?;
        let sample_rate = format.nSamplesPerSec;
        let channels = format.nChannels;
        unsafe {
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    10_000_000,
                    0,
                    format,
                    None,
                )
                .map_err(|e| AppError::Audio(format!("WASAPI Initialize loopback failed: {e}")))?;
        }
        let capture: IAudioCaptureClient = unsafe { client.GetService() }
            .map_err(|e| AppError::Audio(format!("WASAPI capture service failed: {e}")))?;
        unsafe { client.Start() }
            .map_err(|e| AppError::Audio(format!("WASAPI Start failed: {e}")))?;

        let result: AppResult<()> = loop {
            if token.is_cancelled() {
                break Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
            let mut packet = unsafe { capture.GetNextPacketSize() }
                .map_err(|e| AppError::Audio(format!("WASAPI packet size failed: {e}")))?;
            while packet > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                unsafe {
                    capture
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                        .map_err(|e| AppError::Audio(format!("WASAPI GetBuffer failed: {e}")))?;
                }
                let samples = convert_wasapi_buffer(format, data, frames)?;
                unsafe {
                    capture.ReleaseBuffer(frames).map_err(|e| {
                        AppError::Audio(format!("WASAPI ReleaseBuffer failed: {e}"))
                    })?;
                }
                if !samples.is_empty() {
                    let _ = tx.try_send(AudioFrame {
                        samples,
                        sample_rate,
                        channels,
                    });
                }
                packet = unsafe { capture.GetNextPacketSize() }
                    .map_err(|e| AppError::Audio(format!("WASAPI packet size failed: {e}")))?;
            }
        };

        let _ = unsafe { client.Stop() };
        result?;
        Ok(CaptureDevice {
            sample_rate,
            channels,
            ..info
        })
    }

    fn device_enumerator() -> AppResult<IMMDeviceEnumerator> {
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|e| AppError::Audio(format!("WASAPI device enumerator failed: {e}")))
    }

    fn enumerate_endpoints(
        enumerator: &IMMDeviceEnumerator,
        flow: windows::Win32::Media::Audio::EDataFlow,
        prefix: &str,
        kind: DeviceKind,
        default_id: Option<&str>,
    ) -> AppResult<Vec<AudioDeviceInfo>> {
        let collection = unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) }
            .map_err(|e| AppError::Audio(format!("WASAPI endpoint enumeration failed: {e}")))?;
        let count = unsafe { collection.GetCount() }
            .map_err(|e| AppError::Audio(format!("WASAPI endpoint count failed: {e}")))?;
        let mut devices = Vec::new();
        for index in 0..count {
            let endpoint = unsafe { collection.Item(index) }
                .map_err(|e| AppError::Audio(format!("WASAPI endpoint lookup failed: {e}")))?;
            let endpoint_id = endpoint_id(&Some(endpoint.clone()));
            let id = format!("{prefix}_{index}");
            let name = endpoint_friendly_name(&endpoint)
                .unwrap_or_else(|| fallback_endpoint_name(kind, &id, endpoint_id.as_deref()));
            let (sample_rate, channels) = endpoint_mix_format(&endpoint).unwrap_or((48_000, 2));
            devices.push(AudioDeviceInfo {
                id,
                name,
                kind,
                index: index as usize,
                sample_rate,
                channels,
                description: Some(match kind {
                    DeviceKind::System => {
                        "Windows WASAPI loopback for system audio capture.".into()
                    }
                    DeviceKind::Microphone => "Windows microphone/input device.".into(),
                }),
                is_default: endpoint_id.as_deref() == default_id,
            });
        }
        Ok(devices)
    }

    fn endpoint_by_index(
        enumerator: &IMMDeviceEnumerator,
        flow: windows::Win32::Media::Audio::EDataFlow,
        id: &str,
    ) -> AppResult<IMMDevice> {
        let index = parse_trailing_index(id)
            .ok_or_else(|| AppError::Audio(format!("AUDIO_DEVICE_INVALID: {id}")))?
            as u32;
        let collection = unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) }
            .map_err(|e| AppError::Audio(format!("WASAPI endpoint enumeration failed: {e}")))?;
        unsafe { collection.Item(index) }
            .map_err(|e| AppError::Audio(format!("WASAPI endpoint not found: {id}: {e}")))
    }

    fn endpoint_friendly_name(device: &IMMDevice) -> Option<String> {
        let store = unsafe { device.OpenPropertyStore(STGM_READ).ok()? };
        let value = unsafe { store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME).ok()? };
        let raw = unsafe {
            PSFormatForDisplayAlloc(&PKEY_DEVICE_FRIENDLY_NAME, &value, PDFF_DEFAULT).ok()?
        };
        let result = unsafe { raw.to_string().ok() };
        unsafe { CoTaskMemFree(Some(raw.as_ptr() as *const c_void)) };
        result
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn fallback_endpoint_name(kind: DeviceKind, id: &str, endpoint_id: Option<&str>) -> String {
        let id_hint = endpoint_id
            .map(short_device_id)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        format!("{} [{}]", device_kind_label(kind), id_hint)
    }

    fn endpoint_id(device: &Option<IMMDevice>) -> Option<String> {
        let device = device.as_ref()?;
        let raw = unsafe { device.GetId().ok()? };
        let value = unsafe { raw.to_string().ok()? };
        unsafe { CoTaskMemFree(Some(raw.as_ptr() as *const c_void)) };
        Some(value)
    }

    fn endpoint_mix_format(device: &IMMDevice) -> Option<(u32, u16)> {
        let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None).ok()? };
        let format = WaveFormat(unsafe { client.GetMixFormat().ok()? });
        let format = format.as_ref().ok()?;
        Some((format.nSamplesPerSec, format.nChannels))
    }

    fn convert_wasapi_buffer(
        format: &WAVEFORMATEX,
        data: *mut u8,
        frames: u32,
    ) -> AppResult<Vec<i16>> {
        if data.is_null() {
            return Err(AppError::Audio(E_POINTER.to_string()));
        }
        let channels = format.nChannels as usize;
        let sample_count = frames as usize * channels;
        let tag = format.wFormatTag as u32;
        let bits = format.wBitsPerSample;
        let sub_format = if tag == WAVE_FORMAT_EXTENSIBLE {
            let extensible =
                unsafe { &*(format as *const WAVEFORMATEX as *const WAVEFORMATEXTENSIBLE) };
            Some(extensible.SubFormat)
        } else {
            None
        };

        if tag == WAVE_FORMAT_IEEE_FLOAT
            || (tag == WAVE_FORMAT_EXTENSIBLE
                && sub_format == Some(KSDATAFORMAT_SUBTYPE_IEEE_FLOAT))
        {
            if bits != 32 {
                return Err(AppError::Audio(format!(
                    "Unsupported WASAPI float bit depth: {bits}"
                )));
            }
            let values = unsafe { slice::from_raw_parts(data as *const f32, sample_count) };
            return Ok(values.iter().copied().map(i16::from_sample).collect());
        }

        if tag == WAVE_FORMAT_PCM
            || (tag == WAVE_FORMAT_EXTENSIBLE && sub_format == Some(KSDATAFORMAT_SUBTYPE_PCM))
        {
            if bits == 16 {
                let values = unsafe { slice::from_raw_parts(data as *const i16, sample_count) };
                return Ok(values.to_vec());
            }
            if bits == 32 {
                let values = unsafe { slice::from_raw_parts(data as *const i32, sample_count) };
                return Ok(values.iter().map(|value| (*value >> 16) as i16).collect());
            }
        }

        Err(AppError::Audio(format!(
            "Unsupported WASAPI mix format: tag={tag} bits={bits}"
        )))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn fallback_endpoint_names_include_device_identity() {
            assert_eq!(
                fallback_endpoint_name(DeviceKind::System, "wasapi_loopback_0", None),
                "System audio [wasapi_loopback_0]"
            );
            assert_eq!(
                fallback_endpoint_name(
                    DeviceKind::Microphone,
                    "wasapi_mic_1",
                    Some(r"{0.0.1.00000000}.{device-guid}")
                ),
                "Microphone [{device-guid}]"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, name: &str, kind: DeviceKind, index: usize) -> AudioDeviceInfo {
        AudioDeviceInfo {
            id: id.into(),
            name: name.into(),
            kind,
            index,
            sample_rate: 48_000,
            channels: 2,
            description: None,
            is_default: false,
        }
    }

    #[test]
    fn classifies_macos_virtual_audio_as_system() {
        assert_eq!(
            classify_input_device("BlackHole 2ch", "macos"),
            DeviceKind::System
        );
        assert_eq!(
            classify_input_device("MacBook Pro Microphone", "macos"),
            DeviceKind::Microphone
        );
    }

    #[test]
    fn classifies_linux_monitor_audio_as_system() {
        assert_eq!(
            classify_input_device(
                "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor",
                "linux"
            ),
            DeviceKind::System
        );
        assert_eq!(
            classify_input_device("Built-in Audio Analog Stereo", "linux"),
            DeviceKind::Microphone
        );
    }

    #[test]
    fn orders_system_sources_before_microphones() {
        let devices = order_devices(
            vec![
                info("wasapi_mic_2", "Microphone", DeviceKind::Microphone, 2),
                info("wasapi_loopback_1", "Speakers", DeviceKind::System, 1),
            ],
            None,
        );
        assert_eq!(devices[0].id, "wasapi_loopback_1");
        assert_eq!(devices[0].kind, DeviceKind::System);
        assert!(devices[0].is_default);
    }

    #[test]
    fn resolves_legacy_device_ids_to_best_available_device() {
        let devices = vec![
            info("wasapi_loopback_1", "Speakers", DeviceKind::System, 1),
            info("wasapi_mic_2", "Microphone", DeviceKind::Microphone, 2),
        ];
        assert_eq!(
            resolve_device_id(LEGACY_SYSTEM_LOOPBACK_ID, &devices)
                .unwrap()
                .id,
            "wasapi_loopback_1"
        );
        assert_eq!(
            resolve_device_id(LEGACY_DEFAULT_MIC_ID, &devices)
                .unwrap()
                .id,
            "wasapi_mic_2"
        );
        assert!(resolve_device_id("broken_device", &devices).is_none());
    }

    #[test]
    fn builds_distinct_device_display_names() {
        let mut system = info(
            "wasapi_loopback_0",
            "Speakers (Realtek(R) Audio)",
            DeviceKind::System,
            0,
        );
        system.is_default = true;
        assert_eq!(
            device_display_name(&system, false),
            "System audio - Speakers (Realtek(R) Audio) (Default)"
        );

        let microphone = info(
            "wasapi_mic_1",
            "Microphone Array (Intel Smart Sound)",
            DeviceKind::Microphone,
            1,
        );
        assert_eq!(
            device_display_name(&microphone, false),
            "Microphone - Microphone Array (Intel Smart Sound)"
        );
        assert_eq!(
            device_display_name(&microphone, true),
            "Microphone - Microphone Array (Intel Smart Sound) [wasapi_mic_1]"
        );
    }

    #[test]
    fn device_models_mark_duplicate_names_with_ids() {
        let models = devices_to_models(vec![
            info("wasapi_loopback_0", "Speakers", DeviceKind::System, 0),
            info("wasapi_loopback_1", "Speakers", DeviceKind::System, 1),
        ]);

        assert_eq!(
            models[0].display_name.as_deref(),
            Some("System audio - Speakers [wasapi_loopback_0]")
        );
        assert_eq!(
            models[1].display_name.as_deref(),
            Some("System audio - Speakers [wasapi_loopback_1]")
        );
    }

    #[test]
    fn generates_platform_specific_cpal_ids() {
        assert_eq!(
            cpal_device_id(1, DeviceKind::System, "macos"),
            "coreaudio_virtual_1"
        );
        assert_eq!(
            cpal_device_id(1, DeviceKind::System, "linux"),
            "pulse_monitor_1"
        );
        assert_eq!(
            cpal_device_id(1, DeviceKind::Microphone, "linux"),
            "portaudio_input_1"
        );
    }
}
