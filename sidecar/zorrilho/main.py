import os
import sqlite3
import uuid
from pathlib import Path

from fastapi import FastAPI

DATA_DIR = Path(os.environ.get("ZORRILHO_DATA_DIR", Path.home() / ".local/share/zorrilho"))
DB_PATH = DATA_DIR / "zorrilho.db"

app = FastAPI(title="Zorrilho sidecar")


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS voice_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'cloned',
                engine TEXT NOT NULL DEFAULT 'xtts_v2',
                ref_audio_path TEXT,
                ref_text TEXT,
                embedding_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS generation_history (
                id TEXT PRIMARY KEY,
                voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id),
                text TEXT NOT NULL,
                output_path TEXT,
                engine TEXT NOT NULL,
                duration_ms INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """
        )


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "db": str(DB_PATH)}


@app.post("/api/generate")
def generate(text: str, profile_id: str) -> dict:
    # placeholder: real XTTS v2 inference lands in Fase 1
    task_id = uuid.uuid4().hex
    return {"task_id": task_id, "status": "queued"}
