"""CLI de inferência F5-TTS isolado (roda num venv F5 dedicado com numpy>=2).

Uso: python f5_cli.py <ref_audio> <text> <language> <out_wav>
Escreve o WAV de saída; exit != 0 em erro (mensagem no stderr).
"""
import sys
import time
import warnings

warnings.filterwarnings("ignore")


def main() -> int:
    if len(sys.argv) != 5:
        sys.stderr.write("uso: f5_cli.py <ref_audio> <text> <language> <out_wav>\n")
        return 2
    ref_audio, text, language, out_wav = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

    t0 = time.monotonic()
    try:
        from f5_tts.api import F5TTS
    except ImportError as e:
        sys.stderr.write(f"f5_tts não disponível neste venv: {e}\n")
        return 3

    m = F5TTS()
    # modelo baixa/cacheia na primeira execução (weight ~1.3GB)
    sys.stderr.write(f"[f5_cli] modelo pronto em {time.monotonic()-t0:.1f}s\n")

    # transcreve a referência automático (sem text ref) para zero-shot
    elapsed = m.infer(
        ref_file=ref_audio,
        ref_text="",
        gen_text=text,
        file_wave=out_wav,
    )
    sys.stderr.write(f"[f5_cli] síntese em {time.monotonic()-t0:.1f}s (infer {elapsed})\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
