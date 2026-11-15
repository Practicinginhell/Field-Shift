# scripts/ — command wrappers

Use these instead of raw commands.

| Script | Runs |
| --- | --- |
| `setup` | `uv pip install -e "backend[dev]"` (or pip) into the Python env, then `npm install` in `frontend/` |
| `dev` | `uvicorn app.main:app --reload` on :8000 and `vite --strictPort` on :5173; `dev api` or `dev web` for one. First stops whatever is listening on those ports (TERM, then KILL after 5 s) and checks dependencies are installed (if not, it says to run `setup`; it never installs). If one server dies, the other is stopped too. Points the API at the gitignored `.env` (`ENV_FILE`); the API reads secrets such as `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` from it literally, never through the shell |
| `test` | `pytest -q` in `backend/`, then `vitest run` in `frontend/`; `test api …` / `test web …` for one, with extra args passed through |
| `lint` | `ruff check` and `ruff format --check` in `backend/`; `tsc --noEmit` in `frontend/` |
| `format` | `ruff format` and `ruff check --fix` in `backend/` (the frontend has no formatter yet) |

**Python interpreter:** `_env` picks `$PYTHON` if set, else
`~/miniconda3/envs/nasa-challenge/bin/python` if it exists, else `python` on PATH.
Create the env once with `conda create -n nasa-challenge python=3.14`.
