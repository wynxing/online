from __future__ import annotations

from .models import Device


def list_audio_devices() -> list[Device]:
    """Return system-audio-first devices, falling back to demo devices.

    The demo keeps sounddevice optional so the runtime still starts on machines
    without audio dependencies or WASAPI loopback support.
    """
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

    if devices:
        return devices

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
