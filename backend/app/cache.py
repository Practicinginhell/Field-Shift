"""Small disk cache for raw responses from external data services.

Long-term climate and soil data change little, so a cached answer keeps repeated demo
runs fast and lets the app work when a slow service (CropScape) is down. The cache lives
in `<repo>/data/cache/` (gitignored); set `ROTATION_CACHE_DIR` to move it.
"""

import hashlib
import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

_DEFAULT_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"


def cache_dir() -> Path:
    return Path(os.environ.get("ROTATION_CACHE_DIR", _DEFAULT_DIR))


def cached_json(namespace: str, key: dict[str, Any], fetch: Callable[[], Any]) -> Any:
    """Return the cached value for `key`, or call `fetch`, store its result and return it.

    `fetch` must return JSON-serializable data. Exceptions from `fetch` propagate and
    nothing is stored, so a failed request is retried next time.
    """
    digest = hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()[:24]
    path = cache_dir() / namespace / f"{digest}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    value = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return value
