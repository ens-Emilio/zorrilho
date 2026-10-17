mod audio;
mod sidecar;



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
      // garante diretorios de dados — respeita ZORRILHO_DATA_DIR se definido
      if let Ok(root) = std::env::var("ZORRILHO_DATA_DIR") {
          let _ = std::fs::create_dir_all(std::path::Path::new(&root).join("models/hushmic"));
      } else if let Some(data_dir) = dirs::data_dir() {
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
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            sidecar::shutdown();
        }
    });
}
