mod audio;

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
      // garante que diretorio de modelos hushmic exista
      if let Some(data_dir) = dirs::data_dir() {
          let model_dir = data_dir.join("zorrilho/models/hushmic");
          std::fs::create_dir_all(&model_dir).ok();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}