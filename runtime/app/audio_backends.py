"""Cross-platform audio device discovery and stream opening."""

from __future__ import annotations

import contextlib
import logging
import sys
from dataclasses import dataclass
from typing import Protocol

from .models import Device

logger = logging.getLogger("audio.backends")


@dataclass(frozen=True)
class AudioDeviceInfo:
    id: str
    name: str
    kind: str
    index: int
    sample_rate: int
    channels: int
    description: str | None = None
    is_default: bool = False


class AudioStream(Protocol):
    def read(self, frames: int) -> bytes: ...
    def close(self) -> None: ...


class PyAudioStream:
    def __init__(self, pa, stream) -> None:
        self._pa = pa
        self._stream = stream

    def read(self, frames: int) -> bytes:
        return self._stream.read(frames, exception_on_overflow=False)

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._stream.stop_stream()
            self._stream.close()
        with contextlib.suppress(Exception):
            self._pa.terminate()


class SoundDeviceStream:
    def __init__(self, sd, device_index: int, sample_rate: int, channels: int, blocksize: int) -> None:
        self._stream = sd.RawInputStream(
            device=device_index,
            samplerate=sample_rate,
            channels=channels,
            dtype="int16",
            blocksize=blocksize,
        )
        self._stream.start()

    def read(self, frames: int) -> bytes:
        data, overflowed = self._stream.read(frames)
        if overflowed:
            logger.debug("sounddevice input overflowed")
        return bytes(data)

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._stream.stop()
            self._stream.close()


class AudioBackend(Protocol):
    def list_devices(self) -> list[AudioDeviceInfo]: ...
    def open_stream(self, device: AudioDeviceInfo, blocksize: int) -> AudioStream: ...


class WasapiBackend:
    """Windows WASAPI loopback and microphone backend."""

    def list_devices(self) -> list[AudioDeviceInfo]:
        try:
            import pyaudiowpatch as pyaudio
        except ImportError:
            return []

        pa = None
        loopbacks: list[AudioDeviceInfo] = []
        microphones: list[AudioDeviceInfo] = []
        try:
            pa = pyaudio.PyAudio()
            wasapi_info = None
            for i in range(pa.get_host_api_count()):
                info = pa.get_host_api_info_by_index(i)
                if "WASAPI" in str(info.get("name", "")).upper():
                    wasapi_info = info
                    break
            if not wasapi_info:
                return []

            for i in range(pa.get_device_count()):
                info = pa.get_device_info_by_index(i)
                host = pa.get_host_api_info_by_index(info["hostApi"])
                if "WASAPI" not in str(host.get("name", "")).upper():
                    continue

                name = normalize_device_name(str(info.get("name", f"Device {i}")))
                channels = int(info.get("maxInputChannels") or 0)
                sample_rate = int(info.get("defaultSampleRate") or 48000)
                if channels <= 0:
                    continue

                if "[Loopback]" in name:
                    loopbacks.append(
                        AudioDeviceInfo(
                            id=f"wasapi_loopback_{i}",
                            name=name,
                            kind="system",
                            index=i,
                            sample_rate=sample_rate,
                            channels=channels,
                            description="Windows WASAPI loopback for system audio capture.",
                        )
                    )
                else:
                    microphones.append(
                        AudioDeviceInfo(
                            id=f"wasapi_mic_{i}",
                            name=name,
                            kind="microphone",
                            index=i,
                            sample_rate=sample_rate,
                            channels=channels,
                        )
                    )
        except Exception as e:
            logger.debug("pyaudiowpatch device enumeration failed: %s", e)
            return []
        finally:
            if pa:
                with contextlib.suppress(Exception):
                    pa.terminate()

        return mark_first_default(loopbacks + microphones)

    def open_stream(self, device: AudioDeviceInfo, blocksize: int) -> AudioStream:
        import pyaudiowpatch as pyaudio

        pa = pyaudio.PyAudio()
        try:
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=device.channels,
                rate=device.sample_rate,
                input=True,
                input_device_index=device.index,
                frames_per_buffer=blocksize,
            )
        except Exception:
            pa.terminate()
            raise
        return PyAudioStream(pa, stream)


class PortAudioBackend:
    """macOS/Linux input backend via sounddevice/PortAudio."""

    def __init__(self, platform_name: str | None = None) -> None:
        self._platform = platform_name or sys.platform

    def list_devices(self) -> list[AudioDeviceInfo]:
        try:
            import sounddevice as sd  # type: ignore
        except ImportError:
            return []

        devices: list[AudioDeviceInfo] = []
        try:
            raw_devices = sd.query_devices()
            hostapis = _query_hostapis(sd)
            for index, item in enumerate(raw_devices):
                channels = int(item.get("max_input_channels") or 0)
                if channels <= 0:
                    continue

                name = normalize_device_name(str(item.get("name") or f"Device {index}"))
                host_name = _hostapi_name(hostapis, item.get("hostapi"))
                sample_rate = int(item.get("default_samplerate") or 48000)
                kind = _classify_portaudio_device(name, host_name, self._platform)
                devices.append(
                    AudioDeviceInfo(
                        id=_portaudio_device_id(index, kind, self._platform),
                        name=name,
                        kind=kind,
                        index=index,
                        sample_rate=sample_rate,
                        channels=min(channels, 2),
                        description=_portaudio_description(kind, self._platform),
                    )
                )
        except Exception as e:
            logger.debug("sounddevice enumeration failed: %s", e)
            return []

        systems = [device for device in devices if device.kind == "system"]
        microphones = [device for device in devices if device.kind == "microphone"]
        return mark_first_default(systems + microphones)

    def open_stream(self, device: AudioDeviceInfo, blocksize: int) -> AudioStream:
        import sounddevice as sd  # type: ignore

        return SoundDeviceStream(sd, device.index, device.sample_rate, device.channels, blocksize)


def list_audio_device_infos() -> list[AudioDeviceInfo]:
    devices: list[AudioDeviceInfo] = []
    for backend in _platform_backends():
        devices.extend(backend.list_devices())
    return mark_first_default(devices) if devices else []


def list_audio_devices() -> list[Device]:
    devices = [
        Device(
            id=device.id,
            name=device.name,
            kind=device.kind,  # type: ignore[arg-type]
            isDefault=device.is_default,
            description=device.description,
        )
        for device in list_audio_device_infos()
    ]
    return devices or list_mock_devices()


def get_audio_device_info(device_id: str) -> AudioDeviceInfo | None:
    devices = list_audio_device_infos()
    for device in devices:
        if device.id == device_id:
            return device

    if device_id in {"system_loopback", "default_microphone", ""}:
        return devices[0] if devices else None
    return None


def open_audio_stream(device: AudioDeviceInfo, blocksize: int) -> AudioStream:
    backend = _backend_for_device(device.id)
    if not backend:
        raise RuntimeError(f"Unsupported audio device backend: {device.id}")
    return backend.open_stream(device, blocksize)


def is_system_audio_device(device_id: str) -> bool:
    return device_id.startswith(("wasapi_loopback_", "pulse_monitor_", "coreaudio_virtual_"))


def parse_device_index(device_id: str) -> int | None:
    parts = device_id.split("_")
    try:
        return int(parts[-1])
    except (ValueError, IndexError):
        return None


def mark_first_default(devices: list[AudioDeviceInfo]) -> list[AudioDeviceInfo]:
    return [
        AudioDeviceInfo(
            id=device.id,
            name=device.name,
            kind=device.kind,
            index=device.index,
            sample_rate=device.sample_rate,
            channels=device.channels,
            description=device.description,
            is_default=index == 0,
        )
        for index, device in enumerate(devices)
    ]


def normalize_device_name(name: str) -> str:
    try:
        repaired = name.encode("latin1").decode("utf-8")
    except UnicodeError:
        return name

    if "脙" in name or "脗" in name or "猫" in name or "茅" in name:
        return repaired
    return name


def list_mock_devices() -> list[Device]:
    return [
        Device(
            id="system_loopback",
            name="System audio loopback (demo fallback)",
            kind="mock",
            isDefault=True,
            description="Fallback source used when real system audio devices cannot be detected.",
        ),
        Device(
            id="default_microphone",
            name="Default microphone (demo fallback)",
            kind="mock",
            isDefault=False,
            description="Fallback microphone source for mock subtitle generation.",
        ),
    ]


def _platform_backends() -> list[AudioBackend]:
    if sys.platform == "win32":
        return [WasapiBackend()]
    return [PortAudioBackend()]


def _backend_for_device(device_id: str) -> AudioBackend | None:
    if device_id.startswith("wasapi_"):
        return WasapiBackend()
    if device_id.startswith(("coreaudio_", "pulse_", "portaudio_")):
        return PortAudioBackend()
    return None


def _query_hostapis(sd) -> list[dict]:
    with contextlib.suppress(Exception):
        return list(sd.query_hostapis())
    return []


def _hostapi_name(hostapis: list[dict], hostapi_index: object) -> str:
    try:
        return str(hostapis[int(hostapi_index)].get("name") or "")
    except Exception:
        return ""


def _classify_portaudio_device(name: str, host_name: str, platform_name: str) -> str:
    lower = f"{name} {host_name}".lower()
    if platform_name.startswith("linux") and "monitor" in lower:
        return "system"
    if platform_name == "darwin" and any(token in lower for token in ["blackhole", "loopback", "soundflower"]):
        return "system"
    return "microphone"


def _portaudio_device_id(index: int, kind: str, platform_name: str) -> str:
    if platform_name == "darwin":
        prefix = "coreaudio_virtual" if kind == "system" else "coreaudio_input"
    elif platform_name.startswith("linux"):
        prefix = "pulse_monitor" if kind == "system" else "portaudio_input"
    else:
        prefix = "portaudio_input"
    return f"{prefix}_{index}"


def _portaudio_description(kind: str, platform_name: str) -> str | None:
    if platform_name == "darwin" and kind == "system":
        return "macOS virtual audio input for system audio capture."
    if platform_name == "darwin":
        return "macOS microphone/input device."
    if platform_name.startswith("linux") and kind == "system":
        return "Linux PulseAudio/PipeWire monitor source for system audio capture."
    if platform_name.startswith("linux"):
        return "Linux microphone/input device."
    return None
