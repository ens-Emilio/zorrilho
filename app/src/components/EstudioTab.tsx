import { useStore } from "../lib/store";
import { exportUrl } from "../lib/sidecar";
import ZorrilhoIcon from "./ZorrilhoIcon";

export default function EstudioTab() {
  const {
    profiles, selectedProfile, setSelectedProfile,
    text, setText, runGenerate, progress, loading, error,
  } = useStore();

  const chars = text.length;
  const estimatedSec = Math.round((chars / 14) * 10) / 10;
  const gid = progress?.generation_id ?? null;
  const pct = progress ? Math.round(progress.progress) : 0;
  const generating = loading && !!progress && progress.stage !== "done" && progress.stage !== "error";
  const canGenerate = !!selectedProfile && !!text.trim() && !loading;

  return (
    <div className="pane-inner pane-pad" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">Estúdio · XTTS</p>
          <h1>Roteiro</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="label-mono">Voz</span>
          <select
            className="select"
            style={{ minWidth: 200, height: 30 }}
            value={selectedProfile ?? ""}
            onChange={(e) => setSelectedProfile(e.target.value || null)}
          >
            <option value="">Selecione um perfil</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.engine})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="label-mono">Roteiro de síntese</span>
          {generating && <span className="meta num" style={{ padding: "2px 6px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>Gerando… {pct}%</span>}
        </div>
        <textarea
          className="textarea"
          placeholder="Cole o roteiro aqui."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="meta num">{chars} chars · ~{estimatedSec}s · 14.5 c/s</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="meta">PT-BR</span>
            <button className="btn btn-ghost" style={{ height: 26, padding: "0 8px" }} onClick={() => setText("")}>Limpar</button>
          </div>
        </div>
        {generating && <div className="fill"><i style={{ width: `${pct}%` }} /></div>}
        {progress && !generating && (
          <div className="meta num" style={{ color: progress.stage === "error" ? "var(--error)" : "var(--muted)" }}>
            {progress.stage} — {Math.round(progress.progress)}%{progress.elapsed_s ? ` · ${progress.elapsed_s}s` : ""}
            {progress.error ? ` · ${progress.error}` : ""}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ minWidth: 160 }} disabled={!canGenerate} onClick={() => runGenerate()}>
          {loading ? `Gerando… ${pct}%` : "Gerar — XTTS"}
        </button>
        <span className="meta">{!selectedProfile ? "Selecione uma voz" : !text.trim() ? "Digite um roteiro" : loading ? "XTTS rodando na GPU…" : "Pronto para gerar"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}><ZorrilhoIcon size={18} style={{ opacity: 0.7 }} /><span className="meta">watchProgress persiste ao trocar de aba</span></span>
      </div>

      <div className="panel" style={{ padding: "8px 10px", display: "flex", gap: 10, alignItems: "center" }}>
        <span className="label-mono">Saída</span>
        {!gid ? (
          <div style={{ flex: 1, minWidth: 0 }} className="meta">Nenhum áudio gerado ainda.</div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <audio src={`${import.meta.env.VITE_SIDECAR_URL ?? "http://localhost:8765"}/api/generations/${gid}/audio`} style={{ display: "none" }} id="estudio-audio" />
            <button
              className="btn btn-secondary btn-square"
              aria-label="Play"
              onClick={() => {
                const el = document.getElementById("estudio-audio") as HTMLAudioElement | null;
                if (!el) return;
                if (el.paused) el.play();
                else el.pause();
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </button>
            <div className="audio-track" style={{ width: 160, flex: 1 }}><i style={{ width: gid ? "100%" : "0" }} /></div>
            <span className="meta num">WAV · 48 kHz</span>
            <a href={exportUrl(gid, "wav")} className="btn btn-secondary" style={{ textDecoration: "none", height: 28, fontSize: 11 }}>WAV</a>
            <a href={exportUrl(gid, "mp3")} className="btn btn-secondary" style={{ textDecoration: "none", height: 28, fontSize: 11 }}>MP3</a>
          </div>
        )}
      </div>

      {error && <div style={{ padding: "8px 9px", background: "color-mix(in oklch, var(--error) 10%, var(--surface))", border: "1px solid color-mix(in oklch, var(--error) 30%, var(--border))", borderRadius: "var(--radius)", fontSize: 12, color: "var(--error)" }}>{error}</div>}
    </div>
  );
}
