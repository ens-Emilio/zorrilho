// Gravação de voz com denoising DPDFNet in-process (hushmic-denoiser native engine).
// Requer: ~/.local/share/zorrilho/models/hushmic/dpdfnet8_48khz_hr.onnx
//         e o vizinho .weights.f32 (mesmo diretorio).
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

use hound::{SampleFormat, WavSpec, WavWriter};
use hushmic_denoiser::{Denoiser, StreamDenoiser, Inference, SAMPLE_RATE};

static RECORDING: AtomicBool = AtomicBool::new(false);

struct Recorder {
    cleaned: Vec<f32>,
}
static RECORDER: Mutex<Option<Recorder>> = Mutex::new(None);

fn hushmic_model_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("zorrilho/models/hushmic/dpdfnet8_48khz_hr.onnx")
}

/// Inicia gravação denoised do microfone padrão. Retorna erro se já ativa.
#[tauri::command]
pub fn record_start() -> Result<(), String> {
    if RECORDING.load(Ordering::SeqCst) {
        return Err("gravacao ja ativa".into());
    }

    let model_path = hushmic_model_path();
    if !model_path.exists() {
        return Err(format!(
            "modelo hushmic nao encontrado em {}",
            model_path.display()
        ));
    }

    let weights_path = model_path.with_extension("weights.f32");
    if !weights_path.exists() {
        return Err(format!(
            "pesos hushmic nao encontrados em {} (esperado junto ao .onnx)",
            weights_path.display()
        ));
    }

    *RECORDER.lock() = Some(Recorder { cleaned: Vec::new() });
    RECORDING.store(true, Ordering::SeqCst);

    std::thread::spawn(|| {
        if let Err(e) = capture() {
            eprintln!("[zorrilho] captura falhou: {e}");
            RECORDING.store(false, Ordering::SeqCst);
        }
    });
    Ok(())
}

fn capture() -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("sem microfone".to_string())?;
    // denoiser exige 48 kHz mono
    let stream_cfg = cpal::StreamConfig {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        buffer_size: cpal::BufferSize::Default,
    };

    let denoiser = Denoiser::from_file_with(&hushmic_model_path(), Inference::NativeInt8)
        .map_err(|e| e.to_string())?;
    let mut stream_denoiser = StreamDenoiser::new(denoiser);

    let err_cb = |e| eprintln!("[zorrilho] audio err: {e}");
    let stream = device
        .build_input_stream(
            stream_cfg,
            move |data: &[f32], _: &_| {
                if !RECORDING.load(Ordering::SeqCst) {
                    return;
                }
                let cleaned = stream_denoiser.process(data);
                if let Some(rec) = RECORDER.lock().as_mut() {
                    rec.cleaned.extend_from_slice(cleaned);
                }
            },
            err_cb,
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    // bloqueia até record_stop
    while RECORDING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    drop(stream);
    Ok(())
}

/// Para a gravação e escreve o WAV limpo. Retorna o caminho.
#[tauri::command]
pub fn record_stop() -> Result<String, String> {
    RECORDING.store(false, Ordering::SeqCst);
    // aguarda ultima callback
    std::thread::sleep(std::time::Duration::from_millis(200));
    let rec = RECORDER.lock().take().ok_or("nenhuma gravacao ativa")?;
    if rec.cleaned.is_empty() {
        return Err("nada capturado".into());
    }

    let out_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("zorrilho/refs");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let out_path = out_dir.join(format!(
        "ref_{}.wav",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    ));

    let spec = WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(&out_path, spec).map_err(|e| e.to_string())?;
    for &s in &rec.cleaned {
        writer
            .write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn is_recording() -> bool {
    RECORDING.load(Ordering::SeqCst)
}

/// Le um arquivo e retorna os bytes (usado para enviar o WAV ao sidecar).
#[tauri::command]
pub fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}
