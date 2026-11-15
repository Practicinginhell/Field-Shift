import os

from app.envfile import load_env_file


def test_values_are_read_literally_without_shell_expansion(tmp_path, monkeypatch):
    monkeypatch.delenv("SAMPLE_A", raising=False)
    monkeypatch.delenv("SAMPLE_B", raising=False)
    monkeypatch.delenv("SAMPLE_C", raising=False)
    env = tmp_path / ".env"
    env.write_text(
        "# a comment\n"
        "SAMPLE_A=pa$$word#1`x`\n"
        "export SAMPLE_B='quoted $HOME'\n"
        'SAMPLE_C = "spaced"\n',
        encoding="utf-8",
    )

    load_env_file(env)

    assert os.environ["SAMPLE_A"] == "pa$$word#1`x`"
    assert os.environ["SAMPLE_B"] == "quoted $HOME"
    assert os.environ["SAMPLE_C"] == "spaced"


def test_existing_environment_wins_and_missing_file_is_fine(tmp_path, monkeypatch):
    monkeypatch.setenv("SAMPLE_A", "from-shell")
    env = tmp_path / ".env"
    env.write_text("SAMPLE_A=from-file\n", encoding="utf-8")

    load_env_file(env)
    load_env_file(tmp_path / "missing.env")

    assert os.environ["SAMPLE_A"] == "from-shell"
