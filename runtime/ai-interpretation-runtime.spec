# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


ROOT = Path.cwd()
RUNTIME = ROOT / "runtime"


a = Analysis(
    [str(RUNTIME / "run.py")],
    pathex=[str(ROOT), str(RUNTIME)],
    binaries=[],
    datas=[],
    hiddenimports=[
        # runtime.app modules
        "runtime.app.main",
        "runtime.app.models",
        "runtime.app.storage",
        "runtime.app.state",
        "runtime.app.devices",
        "runtime.app.mock_pipeline",
        "runtime.app.real_pipeline",
        "runtime.app.pipeline",
        "runtime.app.pipeline.orchestrator",
        "runtime.app.pipeline.asr_worker",
        "runtime.app.pipeline.segment_processor",
        "runtime.app.pipeline.signal_monitor",
        "runtime.app.pipeline.translation_worker",
        "runtime.app.pipeline.text_sanitize",
        "runtime.app.pipeline.metrics",
        "runtime.app.pipeline.constants",
        "runtime.app.pipeline.utils",
        "runtime.app.asr_provider",
        "runtime.app.audio_capture",
        "runtime.app.segmenter",
        "runtime.app.translation_provider",
        "runtime.app.provider_rules",
        # third-party dependencies that PyInstaller may miss
        "aiosqlite",
        # uvicorn internals
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.loops.auto",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ai-interpretation-runtime",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
