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
        "runtime.app.main",
        "runtime.app.models",
        "runtime.app.storage",
        "runtime.app.state",
        "runtime.app.devices",
        "runtime.app.mock_pipeline",
        "runtime.app.providers",
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
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
