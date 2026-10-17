// Spawn/monitor do sidecar FastAPI.
// Dev: `uv run python -m zorrilho` no sidecar/ do repo (fallback: python -m zorrilho).
// Release: binario adjacente ao exe (externalBin) ou /opt/zorrilho/bin (PKGBUILD).
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use parking_lot::Mutex;
use tauri::AppHandle;
use tauri::Manager;

static SIDECAR: Mutex<Option<Child>> = Mutex::new(None);

pub const SIDECAR_PORT: u16 = 8765;

fn sidecar_tts_home(app: &AppHandle) -> PathBuf {
    // app_data_dir() -> Result; fallback uses dirs crate (Option) -> handle separately
    if let Ok(dir) = app.path().app_data_dir() {
        return dir.join("models");
    }
    if let Some(dir) = dirs::data_dir() {
        return dir.join("zorrilho/models");
    }
    PathBuf::from("/tmp/zorrilho-models")
}

fn dev_sidecar_cmd(app: &AppHandle) -> Option<Command> {
    // sidecar/ fica dois níveis acima de src-tauri/ no repo
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .parent()?
        .join("sidecar");
    if !repo_root.exists() {
        return None;
    }
    let tts_home = sidecar_tts_home(app);
    // tenta `uv run`, fallback `python -m zorrilho`
    if which::which("uv").is_ok() {
        let mut cmd = Command::new("uv");
        cmd.arg("run")
            .arg("python")
            .arg("-m")
            .arg("zorrilho")
            .current_dir(repo_root)
            .env("TTS_HOME", tts_home);
        return Some(cmd);
    }
    // fallback direto
    let mut cmd = Command::new("python");
    cmd.arg("-m")
        .arg("zorrilho")
        .current_dir(repo_root)
        .env("TTS_HOME", tts_home);
    Some(cmd)
}

fn release_sidecar_cmd(app: &AppHandle) -> Option<Command> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let local_bin = exe_dir.join("zorrilho-sidecar");
    if local_bin.exists() {
        let mut cmd = Command::new(local_bin);
        cmd.env("TTS_HOME", sidecar_tts_home(app));
        return Some(cmd);
    }
    let opt_bin = PathBuf::from("/opt/zorrilho/bin/zorrilho-sidecar");
    if opt_bin.exists() {
        let mut cmd = Command::new(opt_bin);
        cmd.env("TTS_HOME", sidecar_tts_home(app));
        return Some(cmd);
    }
    None
}

pub fn spawn(app: &AppHandle) -> Result<(), String> {
    let mut guard = SIDECAR.lock();
    if guard.is_some() {
        return Ok(()); // ja rodando
    }
    let cmd = dev_sidecar_cmd(app).or_else(|| release_sidecar_cmd(app));
    let mut cmd = cmd.ok_or("sidecar nao encontrado (dev: sidecar/ ; release: bin adjacente ou /opt/zorrilho/bin)")?;
    let child = cmd
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    *guard = Some(child);
    Ok(())
}

pub fn wait_healthy(timeout: Duration) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{SIDECAR_PORT}/health");
    let deadline = std::time::Instant::now() + timeout;
    let mut backoff = Duration::from_millis(200);
    let max_backoff = Duration::from_millis(1500);
    loop {
        match reqwest::blocking::get(&url) {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            Ok(_) => {}
            Err(_) => {}
        }
        if std::time::Instant::now() > deadline {
            return Err("sidecar nao respondeu /health a tempo".into());
        }
        std::thread::sleep(backoff);
        backoff = std::cmp::min(backoff.saturating_mul(2), max_backoff);
    }
}

pub fn shutdown() {
    if let Some(mut child) = SIDECAR.lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
