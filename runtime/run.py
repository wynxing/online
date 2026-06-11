import logging
import os
import signal
import sys

import uvicorn

from app.storage import LOG_DIR


def _handle_shutdown(signum: int, frame: object) -> None:
    """Handle termination signals for graceful shutdown on Windows."""
    sys.exit(0)


# uvicorn's default log config writes to sys.stdout / sys.stderr via
# StreamHandler. On Windows, a GUI-subsystem process (PyInstaller `console=False`)
# triggers AllocConsole() the first time Python writes to stdout/stderr, which
# shows up as a brief black cmd window. Redirect every uvicorn logger to a
# FileHandler so the sidecar process never touches stdout/stderr.
_FILE_LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
        "access": {
            "()": "uvicorn.logging.AccessFormatter",
            "fmt": '%(asctime)s %(levelname)s %(client_addr)s - "%(request_line)s" %(status_code)s',
        },
    },
    "handlers": {
        "default": {
            "class": "logging.FileHandler",
            "filename": str(LOG_DIR / "runtime.log"),
            "formatter": "default",
            "mode": "a",
            "encoding": "utf-8",
        },
        "access": {
            "class": "logging.FileHandler",
            "filename": str(LOG_DIR / "runtime.log"),
            "formatter": "access",
            "mode": "a",
            "encoding": "utf-8",
        },
    },
    "loggers": {
        "uvicorn": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"level": "INFO", "handlers": ["default"], "propagate": False},
        "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
    },
}


if __name__ == "__main__":
    # Register signal handlers for graceful shutdown (Windows: SIGTERM, SIGBREAK)
    signal.signal(signal.SIGTERM, _handle_shutdown)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_shutdown)

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_DIR / "runtime.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    port = int(os.environ.get("ONLINE_RUNTIME_PORT", "8765"))
    reload = os.environ.get("ONLINE_RUNTIME_RELOAD", "0") == "1"
    if reload:
        uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=True)
    else:
        from app.main import app

        uvicorn.run(
            app,
            host="127.0.0.1",
            port=port,
            reload=False,
            log_config=_FILE_LOG_CONFIG,
        )
