"""Vercel entry point: the FastAPI app from backend/app, served as one Python function.

vercel.json sends every /api/... request here; the app's own routes start with /api.
Only /tmp is writable on Vercel, so the response cache lives there (it is per instance
and starts empty, which only costs a slower first request).
"""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("ROTATION_CACHE_DIR", str(Path(tempfile.gettempdir()) / "field-shift-cache"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app

__all__ = ["app"]
