"""Load secrets from a `.env` file into the environment, literally.

The file is read as data, never run as shell code: sourcing it with the shell expands
`$`, backticks and `#` inside values and silently changes passwords (this broke the
Earthdata login on 2026-11-14). Lines are `KEY=value`, optionally prefixed with
`export` and with the value in matching quotes. Variables already set in the
environment win. Values are never logged.
"""

import os
from pathlib import Path


def load_env_file(path: Path) -> None:
    """Set each `KEY=value` from `path` that is not already in the environment."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key, value)
