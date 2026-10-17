// Gravação de voz com denoising DPDFNet in-process (hushmic-denoiser native engine).
// Requer: ~/.local/share/zorrilho/models/hushmic/dpdfnet8_48khz_hr.onnx
//         e o vizinho .weights.f32 (mesmo diretório). Pode ter overrides via
//         ZORRILHO_DATA_DIR. Limite: 5 min por gravação para evitar OOM.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

use hound::{SampleFormat, WavSpec, WavWriter};
use hushmic_denoiser::{Denoiser, Inference, StreamDenoiser, SAMPLE_RATE};

use parking_lot::Mutex;

// 5 min @ 48 kHz = 14.4M amostras ~ 57 MiB f32 — limite anti-OOM
const MAX_SAMPLES: usize = 48_000 * 60 * 5;

static RECORDING: AtomicBool = AtomicBool::new(false);

// Canal: capture thread -> record_stop consome sem polling
type CaptureMsg = Vec<f32>;
static CHANNEL: Mutex<Option<mpsc::Receiver<CaptureMsg>>> = Mutex::new(None);

fn data_root() -> PathBuf {
    if let Ok(dir) = std::env::var("ZORRILHO_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("zorrilho")
}

fn hushmic_model_path() -> PathBuf {
    data_root().join("models/hushmic/dpdfnet8_48khz_hr.onnx")
}

fn load_denoiser() -> Result<Denoiser, String> {
    let path = hushmic_model_path();
    if !path.exists() {
        return Err(format!("modelo hushmic não encontrado em {}", path.display()));
    }
    let weights = path.with_extension("weights.f32");
    if !weights.exists() {
        return Err(format!(
            "pesos hushmic não encontrados em {} (esperado junto ao .onnx)",
            weights.display()
        ));
    }
    Denoiser::from_file_with(&path, Inference::NativeInt8).map_err(|e| e.to_string())
}

/// Inicia gravação denoised do microfone padrão. Retorna erro se já ativa.
#[tauri::command]
pub fn record_start() -> Result<(), String> {
    if RECORDING.load(Ordering::SeqCst) {
        return Err("gravação já ativa".into());
    }
    // valida que o modelo existe antes de spawn
    let _ = load_denoiser()?;

    let (tx, rx) = mpsc::channel::<CaptureMsg>();
    *CHANNEL.lock() = Some(rx);
    RECORDING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        if let Err(e) = capture(tx) {
            eprintln!("[zorrilho] captura falhou: {e}");
            RECORDING.store(false, Ordering::SeqCst);
        }
    });
    Ok(())
}

fn capture(tx: mpsc::Sender<CaptureMsg>) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("sem microfone".to_string())?;

    // negociação: prefere 48 kHz mono; se indisponível, aceita o default e avisa
    let supported = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .collect::<Vec<_>>();
    let has_48_mono = supported.iter().any(|c| {
        c.channels() == 1 && c.min_sample_rate() <= 48_000 && c.max_sample_rate() >= 48_000
    });

    let stream_cfg = cpal::StreamConfig {
        channels: 1,
        sample_rate: 48_000,
        buffer_size: cpal::BufferSize::Default,
    };

    if !has_48_mono {
        eprintln!(
            "[zorrilho] 48 kHz mono não anunciado; tentando 48 kHz mesmo assim ({} configs)",
            supported.len()
        );
    }

    let denoiser = load_denoiser()?;
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
                let _ = tx.send(cleaned.to_vec());
            },
            err_cb,
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    while RECORDING.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(80));
    }
    drop(stream);
    Ok(())
}

/// Para a gravação e escreve o WAV limpo. Retorna o caminho.
#[tauri::command]
pub fn record_stop() -> Result<String, String> {
    RECORDING.store(false, Ordering::SeqCst);
    // drena canal sem busy-poll fixo: aguarda até o sender morrer (capture thread terminou)
    let rx_opt = CHANNEL.lock().take();
    let mut cleaned: Vec<f32> = Vec::new();
    if let Some(rx) = rx_opt {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(400);
        loop {
            match rx.recv_timeout(std::time::Duration::from_millis(30)) {
                Ok(chunk) => {
                    if cleaned.len() + chunk.len() > MAX_SAMPLES {
                        let remain = MAX_SAMPLES.saturating_sub(cleaned.len());
                        cleaned.extend_from_slice(&chunk[..remain]);
                        break;
                    }
                    cleaned.extend_from_slice(&chunk);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if std::time::Instant::now() > deadline {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    }
    if cleaned.is_empty() {
        return Err("nada capturado".into());
    }
    if cleaned.len() >= MAX_SAMPLES {
        eprintln!("[zorrilho] gravação truncada em 5 min (limite)");
    }

    let out_dir = data_root().join("refs");
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
    for &s in &cleaned {
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

/// Lê um arquivo do diretório de dados do app. Path traversal é bloqueado.
#[tauri::command]
pub fn read_file(path: String) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    let allowed_roots = [data_root(), dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))];
    let canonical = p.canonicalize().unwrap_or(p.clone());
    let allowed = allowed_roots.iter().any(|root| {
        let cr = root.canonicalize().unwrap_or(root.clone());
        canonical.starts_with(&cr)
    });
    if !allowed {
        return Err("acesso negado: arquivo fora do diretório do app".into());
    }
    std::fs::read(&p).map_err(|e| e.to_string())
}
