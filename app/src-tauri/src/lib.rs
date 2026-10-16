mod audio;
mod sidecar;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      audio::record_start,
      audio::record_stop,
      audio::is_recording,
      audio::read_file,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // garante diretorios de dados
      if let Some(data_dir) = dirs::data_dir() {
          let model_dir = data_dir.join("zorrilho/models/hushmic");
          std::fs::create_dir_all(&model_dir).ok();
      }
      let handle = app.handle().clone();
      std::thread::spawn(move || {
          if let Err(e) = sidecar::spawn(&handle) {
              eprintln!("[zorrilho] sidecar spawn falhou: {e}");
              return;
          }
          if let Err(e) = sidecar::wait_healthy(std::time::Duration::from_secs(30)) {
              eprintln!("[zorrilho] sidecar health check falhou: {e}");
          } else {
              println!("[zorrilho] sidecar saudavel na porta {}", sidecar::SIDECAR_PORT);
          }
      });
      Ok(())
    })
    .on_window_event(|window, event| {
        // shutdown do sidecar ao fechar a janela principal
        if let tauri::WindowEvent::Destroyed = event {
            sidecar::shutdown();
        }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
