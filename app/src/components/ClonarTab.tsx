import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { exportUrl } from "../lib/sidecar";
import { invoke } from "@tauri-apps/api/core";

export default function ClonarTab() {
  const {
    recording, setRecording, refWav, setRefWav,
    profiles, setError, newProfile, error,
  } = useStore();

  const [timer, setTimer] = useState(0);
  const [capture, setCapture] = useState<"idle" | "recording" | "denoising" | "ready">("idle");
  const [name, setName] = useState("");
  const [denoising, setDenoising] = useState(false);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    if (recording) {
      timerRef.current = window.setInterval(() => setTimer((s) => s + 0.1), 100);
    } else {
      clearInterval(timerRef.current);
    }
    return () => { clearInterval(timerRef.current); };
  }, [recording]);

  useEffect(() => {
    if (refWav && !recording) setCapture("ready");
    else if (denoising) setCapture("denoising");
    else if (recording) setCapture("recording");
    else setCapture("idle");
  }, [refWav, recording, denoising]);

  function fmt(s: number) {
    const m = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(Math.floor(s % 60)).padStart(2, "0");
    return `${m}:${ss}`;
  }

  async function toggleRecording() {
    setError(null);
    try {
      if (!recording) {
        setTimer(0);
        setDenoising(false);
        await invoke("record_start");
        setRecording(true);
        setCapture("recording");
      } else {
        setDenoising(true);
        setCapture("denoising");
        const path = await invoke<string>("record_stop");
        const bytes = await invoke<number[]>("read_file", { path });
        setRefWav(new Uint8Array(bytes));
        setRecording(false);
        setDenoising(false);
        setCapture("ready");
      }
    } catch (e) {
      setError(`Gravação: ${e}`);
      setRecording(false);
      setDenoising(false);
      setCapture("idle");
    }
  }

  const pct = Math.min(100, (timer / 6) * 100);
  const progress = useStore((s) => s.progress);
  const gid = progress?.generation_id ?? null;
  const canCreate = name.trim().length >= 2 && !!refWav && !recording && !denoising;
  const createLabel = !refWav ? "Criar perfil — gravar primeiro" : !canCreate && name.trim().length < 2 ? "Criar perfil — nome com ≥2 caracteres" : "Criar perfil";

  return (
    <div className="pane-inner pane-pad" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">HushMic · captura</p>
          <h1>
            Máquina: <span className="num" style={{ color: "var(--muted)" }}>{capture === "idle" ? "idle" : capture === "recording" ? "recording" : capture === "denoising" ? "denoising" : "ready"}</span>
          </h1>
        </div>
        <div className="panel" style={{ padding: "6px 8px", display: "flex", gap: 8, alignItems: "center" }}>
          <span className="meta">Atalho</span><span className="kbd">SPACE</span>
          <span style={{ width: 1, height: 14, background: "var(--border)" }} />
          <span className="meta" style={{ color: capture === "ready" ? "var(--success)" : "var(--muted)" }}>● {capture === "ready" ? "HushMic pronto" : "HushMic"}</span>
        </div>
      </div>

      <div className="pane-grid">
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, borderRight: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="label-mono">Gravador HushMic</span>
            <span className="meta" style={{ padding: "2px 6px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)", color: capture === "recording" ? "var(--recording)" : capture === "denoising" ? "var(--warning)" : capture === "ready" ? "var(--success)" : "var(--muted)" }}>{capture}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0 2px" }}>
            <button className={`btn-rec ${recording ? "recording" : ""}`} onClick={toggleRecording} aria-label="Gravar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /><path d="M8 21h8" /></svg>
            </button>
            <div className="num" style={{ fontSize: 22, letterSpacing: "-0.04em", lineHeight: 1 }}>{fmt(timer)}</div>
            <div className="meta" style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 9, color: timer >= 6 && recording ? "var(--success)" : "var(--muted)" }}>
              {recording ? (timer >= 6 ? "✓ 6s atingido — pode parar" : `Gravando… ${Math.max(0, 6 - Math.floor(timer))}s até ideal`) : denoising ? "Processando DPDFNet no Rust…" : capture === "ready" ? "Amostra limpa disponível" : "Pressione para gravar · ideal 6s"}
            </div>
          </div>

          <div>
            <div className={`timeline ${capture === "ready" ? "ready" : ""} ${capture === "denoising" ? "warn" : ""}`}>
              <i style={{ width: capture === "idle" ? "0%" : capture === "recording" ? `${pct}%` : "100%", background: capture === "ready" ? "var(--success)" : capture === "denoising" ? "var(--warning)" : capture === "recording" ? "var(--recording)" : undefined }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }} className="meta">
              <span className="num">0s</span><span className="num" style={{ color: "var(--success)" }}>6s ideal XTTS</span><span className="num">10s</span>
            </div>
          </div>

          {denoising && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>
              <span style={{ width: 12, height: 12, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
              <span className="meta" style={{ color: "var(--fg)" }}>DPDFNet · removendo ruído no Rust…</span>
              <span className="meta num" style={{ marginLeft: "auto" }}>48 kHz</span>
            </div>
          )}

          {refWav && !denoising && (
            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              <div className="audio-row">
                <span className="meta num" style={{ color: "var(--success)" }}>Voz limpa</span>
                <span className="meta num" style={{ marginLeft: "auto" }}>{fmt(refWav.length / 48000 / 2)} / {fmt(refWav.length / 48000 / 2)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setRefWav(null); setCapture("idle"); setTimer(0); }}>Descartar / Regravar</button>
                <span className="meta" style={{ color: "var(--success)" }}>48kHz · {(refWav.length / 1024).toFixed(1)} KB</span>
              </div>
              {gid && (
                <div style={{ display: "flex", gap: 6 }}>
                  <a href={exportUrl(gid, "wav")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none" }}>⬇ WAV</a>
                  <a href={exportUrl(gid, "mp3")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none" }}>⬇ MP3</a>
                </div>
              )}
            </div>
          )}

          <div className="meta" style={{ fontSize: 10 }}>{profiles.length} perfis · {refWav ? "amostra pronta" : "sem amostra"}</div>
        </div>

        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <span className="label-mono">Criar perfil</span>
            <div className="meta" style={{ marginTop: 4 }}>draftProfileName controlado no store. Botão bloqueia até nome + áudio ready.</div>
          </div>

          <div className="field">
            <label htmlFor="profileName">Nome do perfil</label>
            <input className="input" id="profileName" placeholder="Ex: Ana — comercial" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            <span className="meta">{name.trim().length >= 2 ? "✓ pronto para criar" : name.length ? `${name.trim().length}/2 — continue` : "Mín. 2 caracteres"}</span>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 9px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: capture === "ready" ? "var(--success)" : capture === "denoising" ? "var(--warning)" : capture === "recording" ? "var(--recording)" : "var(--border)", flexShrink: 0 }} />
            <span className="meta" style={{ color: capture === "ready" ? "var(--success)" : capture === "denoising" ? "var(--warning)" : capture === "recording" ? "var(--recording)" : "var(--muted)" }}>
              {capture === "ready" ? "Voz limpa 48kHz pronta" : capture === "denoising" ? "DPDFNet processando…" : capture === "recording" ? "Capturando…" : "Aguardando gravação limpa"}
            </span>
            <span className="meta num" style={{ marginLeft: "auto" }}>{refWav ? `#${(refWav.length % 9973).toString(16).padStart(3, "0")} · ${(refWav.length / 48000 / 2).toFixed(1)}s` : "# —"}</span>
          </div>

          <button className="btn btn-primary btn-block" disabled={!canCreate} onClick={() => canCreate && newProfile(name)}>{createLabel}</button>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="meta" style={{ padding: "3px 6px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>XTTS · #8B5CF6</span>
            <span className="meta" style={{ padding: "3px 6px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>DPDFNet · 48kHz</span>
          </div>

          <div className="hairline" style={{ marginTop: 2 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {["idle", "recording", "denoising", "ready"].map((s, i) => {
              const order = ["idle", "recording", "denoising", "ready"];
              const active = order.indexOf(capture) >= order.indexOf(s);
              const col = s === "recording" ? "var(--recording)" : s === "denoising" ? "var(--warning)" : s === "ready" ? "var(--success)" : "var(--fg)";
              return (
                <span key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 9, border: `1px solid ${active ? col : "var(--border)"}`, background: active ? (s === "idle" ? "var(--fg)" : col) : "var(--elevated)", color: active ? "#fff" : "var(--muted)" }}>{i + 1}</span>
                  <span className="meta" style={{ color: active ? col : "var(--muted)", fontSize: 9 }}>{s}</span>
                  {s !== "ready" && <span style={{ width: 10, height: 1, background: "var(--border)" }} />}
                </span>
              );
            })}
          </div>

          {error && (
            <div style={{ padding: "8px 9px", background: "color-mix(in oklch, var(--error) 10%, var(--surface))", border: "1px solid color-mix(in oklch, var(--error) 30%, var(--border))", borderRadius: "var(--radius)", fontSize: 12, color: "var(--error)" }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
