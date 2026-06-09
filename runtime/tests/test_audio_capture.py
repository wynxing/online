"""WASAPI loopback 可行性验证脚本。

用法：
  1. 播放一段音频（YouTube、音乐、视频等）
  2. 运行本脚本：python test_audio_capture.py
  3. 脚本会采集 5 秒系统音频并保存为 test_capture.wav
  4. 用播放器打开 test_capture.wav 确认能听到系统声音
"""

from __future__ import annotations

import io
import sys
import wave
from pathlib import Path

# 确保 stdout 支持 UTF-8
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


def find_wasapi_loopback():
    """查找 WASAPI loopback 设备，返回 (pyaudio, device_info) 或 (None, None)。"""
    import pyaudiowpatch as pyaudio

    pa = pyaudio.PyAudio()

    # 查找 WASAPI host API
    wasapi_info = None
    for i in range(pa.get_host_api_count()):
        info = pa.get_host_api_info_by_index(i)
        if "WASAPI" in info.get("name", "").upper():
            wasapi_info = info
            break

    if not wasapi_info:
        pa.terminate()
        return None, None

    # 查找带 [Loopback] 标记的设备
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        host = pa.get_host_api_info_by_index(info["hostApi"])
        if "WASAPI" not in host.get("name", "").upper():
            continue
        if "[Loopback]" in info.get("name", "") and info["maxInputChannels"] > 0:
            return pa, info

    # 没有显式 Loopback 设备，尝试用默认输出设备
    default_out_index = wasapi_info.get("defaultOutputDevice")
    if default_out_index is not None and default_out_index >= 0:
        return pa, pa.get_device_info_by_index(default_out_index)

    pa.terminate()
    return None, None


def main() -> None:
    try:
        import pyaudiowpatch as pyaudio
    except ImportError:
        print("ERROR: pyaudiowpatch 未安装，请运行: pip install pyaudiowpatch")
        return

    pa, loopback = find_wasapi_loopback()
    if not pa or not loopback:
        print("ERROR: 未找到 WASAPI loopback 设备")
        return

    channels = int(loopback["maxInputChannels"])
    sample_rate = int(loopback["defaultSampleRate"])
    name = loopback["name"]

    print(f"Loopback 设备: {name}")
    print(f"  声道: {channels}, 采样率: {sample_rate}")

    stream = None
    try:
        stream = pa.open(
            format=pyaudio.paInt16,
            channels=channels,
            rate=sample_rate,
            input=True,
            input_device_index=loopback["index"],
            frames_per_buffer=1024,
        )
        print("\n采集已启动（阻塞模式），请确保正在播放音频...")
        print("等待 5 秒...\n")

        frames = []
        chunks_per_second = sample_rate // 1024
        total_chunks = chunks_per_second * 5

        for i in range(total_chunks):
            data = stream.read(1024, exception_on_overflow=False)
            frames.append(data)
            if (i + 1) % chunks_per_second == 0:
                second = (i + 1) // chunks_per_second
                print(f"  已采集 {second} 秒...")

        stream.stop_stream()
        stream.close()

        # 保存为 WAV
        output_path = Path(__file__).parent / "test_capture.wav"
        pcm_data = b"".join(frames)
        with wave.open(str(output_path), "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_data)

        duration = len(pcm_data) / (sample_rate * channels * 2)
        print(f"\n采集完成！文件: {output_path}")
        print(f"  大小: {output_path.stat().st_size / 1024:.1f} KB")
        print(f"  时长: {duration:.1f} 秒, {channels} 声道, {sample_rate} Hz")
        print("\n请用播放器打开 test_capture.wav 确认能听到系统播放的声音。")

    except Exception as e:
        print(f"\nFAILED: {e}")
    finally:
        if stream:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:
                pass
        pa.terminate()


if __name__ == "__main__":
    main()
