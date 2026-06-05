import os
import logging

import uvicorn

from app.storage import LOG_DIR


if __name__ == "__main__":
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

        uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
