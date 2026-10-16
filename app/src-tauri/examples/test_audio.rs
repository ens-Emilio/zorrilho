use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;

use std::time::{Duration, Instant};

use hound::{SampleFormat, WavSpec, WavWriter};
use hushmic_denoiser::{Denoiser, StreamDenoiser, SAMPLE_RATE};

fn model_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let model = model_path();
    if !model.exists() {
        return Err(format!("modelo nao encontrado: {model.display()}").into());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("nenhum dispositivo de entrada encontrado")?;

    let cfg = device.default_input_config()?;
    let supported_cfg = match cfg.sample_format() {
        cpal::SampleFormat::F32 => cfg,
        cpal::SampleFormat::I16 => cfg,
        _ => return Err("formato de amostra nao suportado (esperado f32 ou i16)".into()),
    };

    let stream_config = cpal::StreamConfig {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        buffer_size: cpal::BufferSize::Default,
    };

    let denoiser = Denoiser::from_file(&model)?;
    let mut stream_denoiser = StreamDenoiser::new(denoiser);

    let (tx, rx) = mpsc::channel();
    let recording = Arc::new(AtomicBool::new(true));
    let r = recording.clone();

    let err_cb = move |e| eprintln!("[zorrilho-test] audio err: {e}");
    let stream = device.build_input_stream(
        stream_config,
        move |data: &[f32], _: &_| {
            if !recording.load(Ordering::SeqCst) {
                return;
            }
            let cleaned = stream_denoiser.process(data);
            if let Ok(_) = tx.send(cleaned.to_vec()) {
                // ignoramos erro de send se o outro lado morrer
            }
        },
        err_cb,
        None,
    )?;
    stream.play()?;

    let mut cleaned_all = Vec::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(2) && recording.load(Ordering::SeqCst) {
        if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
            cleaned_all.extend_from_slice(&chunk);
        }
    }
    recording.store(false, Ordering::SeqCst);
    drop(stream);

    let out_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("zorrilho/test_out");
    std::fs::create_dir_all(&out_dir)?;
    let out_path = out_dir.join(format!(
        "test_{}.wav",
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
    let mut writer = WavWriter::create(&out_path, spec)?;
    for &s in &cleaned_all {
        writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
    }
    writer.finalize()?;

    println!(
        "test concluido: {} amostras (~{:.2}s) salvo em {} ",
        cleaned_all.len(),
        cleaned_all.len() as f32 / SAMPLE_RATE as f32,
        out_path.display()
    );
    Ok(())
}