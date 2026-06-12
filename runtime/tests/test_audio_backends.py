from __future__ import annotations

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.audio_backends import PortAudioBackend, WasapiBackend, get_audio_device_info, list_audio_devices
from app.pipeline.orchestrator import run_real_subtitle_pipeline


class FakeWasapiPyAudio:
    def get_host_api_count(self):
        return 1

    def get_host_api_info_by_index(self, index):
        assert index == 0
        return {"name": "Windows WASAPI", "defaultOutputDevice": 0}

    def get_device_count(self):
        return 3

    def get_device_info_by_index(self, index):
        devices = [
            {"name": "Speakers", "hostApi": 0, "maxInputChannels": 0, "defaultSampleRate": 48000},
            {"name": "Speakers [Loopback]", "hostApi": 0, "maxInputChannels": 2, "defaultSampleRate": 48000},
            {"name": "Microphone", "hostApi": 0, "maxInputChannels": 1, "defaultSampleRate": 44100},
        ]
        return devices[index]

    def terminate(self):
        return None


def test_wasapi_backend_lists_loopback_before_microphone():
    fake_module = SimpleNamespace(PyAudio=FakeWasapiPyAudio)

    with patch.dict(sys.modules, {"pyaudiowpatch": fake_module}):
        devices = WasapiBackend().list_devices()

    assert [device.id for device in devices] == ["wasapi_loopback_1", "wasapi_mic_2"]
    assert devices[0].kind == "system"
    assert devices[0].is_default is True
    assert devices[0].sample_rate == 48000
    assert devices[0].channels == 2


class FakeSoundDevice:
    def __init__(self, devices, hostapis):
        self._devices = devices
        self._hostapis = hostapis

    def query_devices(self):
        return self._devices

    def query_hostapis(self):
        return self._hostapis


def test_macos_virtual_audio_is_system_and_microphone_is_fallback():
    fake_sd = FakeSoundDevice(
        [
            {"name": "MacBook Pro Microphone", "hostapi": 0, "max_input_channels": 1, "default_samplerate": 44100},
            {"name": "BlackHole 2ch", "hostapi": 0, "max_input_channels": 2, "default_samplerate": 48000},
        ],
        [{"name": "Core Audio"}],
    )

    with patch.dict(sys.modules, {"sounddevice": fake_sd}):
        devices = PortAudioBackend(platform_name="darwin").list_devices()

    assert [device.id for device in devices] == ["coreaudio_virtual_1", "coreaudio_input_0"]
    assert devices[0].kind == "system"
    assert devices[0].description == "macOS virtual audio input for system audio capture."
    assert devices[1].kind == "microphone"


def test_linux_monitor_source_is_system_and_preferred():
    fake_sd = FakeSoundDevice(
        [
            {
                "name": "Built-in Audio Analog Stereo",
                "hostapi": 0,
                "max_input_channels": 2,
                "default_samplerate": 44100,
            },
            {
                "name": "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor",
                "hostapi": 1,
                "max_input_channels": 2,
                "default_samplerate": 48000,
            },
        ],
        [{"name": "PulseAudio"}, {"name": "PulseAudio"}],
    )

    with patch.dict(sys.modules, {"sounddevice": fake_sd}):
        devices = PortAudioBackend(platform_name="linux").list_devices()

    assert [device.id for device in devices] == ["pulse_monitor_1", "portaudio_input_0"]
    assert devices[0].kind == "system"
    assert devices[0].is_default is True
    assert "PipeWire" in (devices[0].description or "")


def test_list_audio_devices_falls_back_to_mock_when_no_backend_available():
    with patch("app.audio_backends.sys.platform", "linux"), patch.dict(sys.modules, {"sounddevice": None}):
        devices = list_audio_devices()

    assert devices[0].id == "system_loopback"
    assert devices[0].kind == "mock"


def test_legacy_device_id_resolves_to_current_default_device():
    fake_sd = FakeSoundDevice(
        [{"name": "BlackHole 2ch", "hostapi": 0, "max_input_channels": 2, "default_samplerate": 48000}],
        [{"name": "Core Audio"}],
    )

    with patch("app.audio_backends.sys.platform", "darwin"), patch.dict(sys.modules, {"sounddevice": fake_sd}):
        device = get_audio_device_info("system_loopback")

    assert device is not None
    assert device.id == "coreaudio_virtual_0"


class InvalidDeviceTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_device_id_broadcasts_audio_device_invalid(self):
        events: list[tuple[str, dict]] = []

        async def broadcast(event_type: str, payload: dict) -> None:
            events.append((event_type, payload))

        with patch("app.pipeline.orchestrator.get_audio_device_info", return_value=None):
            await run_real_subtitle_pipeline(
                session_id="session_test",
                config=SimpleNamespace(
                    asrFormat="whisper",
                    asrModel="whisper-1",
                    asrLanguage="en",
                    asrBaseUrl="",
                    baseUrl="https://example.test/v1",
                    asrApiKey="",
                    apiKey="test",
                ),
                broadcast=broadcast,
                should_stop=lambda: True,
                device_id="broken_device",
                glossary_terms=[],
            )

        self.assertIn(
            (
                "runtime.error",
                {
                    "code": "AUDIO_DEVICE_INVALID",
                    "message": "Cannot parse audio device id: broken_device",
                    "recoverable": False,
                },
            ),
            events,
        )
        self.assertTrue(any(event == "session.status" and payload["status"] == "stopped" for event, payload in events))
