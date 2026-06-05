from __future__ import annotations

import logging

from .models import Device

logger = logging.getLogger("devices")


def list_audio_devices() -> list[Device]:
    """Return system-audio-first devices, falling back to demo devices.

    Priority: pyaudiowpatch (WASAPI) > sounddevice > mock.
    """
    devices = _list_devices_pyaudiowpatch()
    if devices:
        return devices

    devices = _list_devices_sounddevice()
    if devices:
        return devices

    return _list_mock_devices()


def _list_devices_pyaudiowpatch() -> list[Device]:
    """Enumerate WASAPI devices via pyaudiowpatch."""
    try:
        import pyaudiowpatch as pyaudio
    except ImportError:
        return []

    devices: list[Device] = []
    pa = None
    try:
        pa = pyaudio.PyAudio()

        # Find WASAPI host API
        wasapi_info = None
        for i in range(pa.get_host_api_count()):
            info = pa.get_host_api_info_by_index(i)
            if "WASAPI" in info.get("name", "").upper():
                wasapi_info = info
                break

        if not wasapi_info:
            return []

        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            host = pa.get_host_api_info_by_index(info["hostApi"])
            if "WASAPI" not in host.get("name", "").upper():
                continue

            name = info.get("name", f"Device {i}")
            max_in = int(info.get("maxInputChannels") or 0)
            max_out = int(info.get("maxOutputChannels") or 0)

            if "[Loopback]" in name and max_in > 0:
                devices.append(
                    Device(
                        id=f"wasapi_loopback_{i}",
                        name=f"{name}",
                        kind="system",
                        isDefault=len(devices) == 0,
                        description="Windows WASAPI loopback for system audio capture.",
                    )
                )
            elif max_in > 0 and "[Loopback]" not in name:
                devices.append(
                    Device(
                        id=f"mic_{i}",
                        name=name,
                        kind="microphone",
                        isDefault=False,
                    )
                )

    except Exception as e:
        logger.debug("pyaudiowpatch 枚举失败: %s", e)
        devices = []
    finally:
        if pa:
            try:
                pa.terminate()
            except Exception:
                pass

    return devices


def _list_devices_sounddevice() -> list[Device]:
    """Enumerate devices via sounddevice (fallback)."""
    devices: list[Device] = []
    try:
        import sounddevice as sd  # type: ignore

        raw_devices = sd.query_devices()
        for index, item in enumerate(raw_devices):
            max_output = int(item.get("max_output_channels") or 0)
            max_input = int(item.get("max_input_channels") or 0)
            name = str(item.get("name") or f"Device {index}")
            if max_output > 0:
                devices.append(
                    Device(
                        id=f"wasapi_loopback_{index}",
                        name=f"{name} (system audio loopback)",
                        kind="system",
                        isDefault=len(devices) == 0,
                        description="Windows loopback candidate for system audio capture.",
                    )
                )
            elif max_input > 0:
                devices.append(
                    Device(
                        id=f"mic_{index}",
                        name=name,
                        kind="microphone",
                        isDefault=False,
                    )
                )
    except Exception:
        devices = []

    return devices


def _list_mock_devices() -> list[Device]:
    """Fallback mock devices when no real audio is available."""
    return [
        Device(
            id="system_loopback",
            name="System audio loopback (demo fallback)",
            kind="mock",
            isDefault=True,
            description="Fallback source used when Windows loopback devices cannot be detected.",
        ),
        Device(
            id="default_microphone",
            name="Default microphone (demo fallback)",
            kind="mock",
            isDefault=False,
            description="Fallback microphone source for mock subtitle generation.",
        ),
    ]
