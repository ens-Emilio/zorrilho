// Spawn/monitor do sidecar FastAPI.
// Dev: `uv run python -m zorrilho` no sidecar/ do repo.
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
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .unwrap_or_else(|_| PathBuf::from(".local/share/zorrilho/models"))
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
    let mut cmd = Command::new("uv");
    cmd.arg("run")
        .arg("python")
        .arg("-m")
        .arg("zorrilho")
        .current_dir(repo_root)
        .env("TTS_HOME", sidecar_tts_home(app));
    Some(cmd)
}

fn release_sidecar_cmd(app: &AppHandle) -> Option<Command> {
    // 1. binario adjacente ao exe ( externalBin do tauri )
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let local_bin = exe_dir.join("zorrilho-sidecar");
    if local_bin.exists() {
        let mut cmd = Command::new(local_bin);
        cmd.env("TTS_HOME", sidecar_tts_home(app));
        return Some(cmd);
    }
    // 2. instalacao via PKGBUILD ( /opt/zorrilho/bin )
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
    loop {
        if let Ok(resp) = reqwest::blocking::get(&url) {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        if std::time::Instant::now() > deadline {
            return Err("sidecar nao respondeu /health a tempo".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

pub fn shutdown() {
    if let Some(mut child) = SIDECAR.lock().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
