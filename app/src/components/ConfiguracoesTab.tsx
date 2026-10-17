import { useState } from "react";
import { useStore } from "../lib/store";

export default function ConfiguracoesTab() {
  const { health, downloadAssets, assetsProgress, refresh, error } = useStore();
  const [licenseOk, setLicenseOk] = useState(false);

  const pct = assetsProgress ? Math.round((assetsProgress.done / Math.max(1, assetsProgress.total)) * 100) : 0;
  const downloading = !!assetsProgress && assetsProgress.done < assetsProgress.total;
  const done = !!assetsProgress && assetsProgress.done >= assetsProgress.total;

  return (
    <div className="pane-inner pane-pad" style={{ gap: 12 }}>
      <div>
        <p className="eyebrow">Configurações · first-run</p>
        <h1>Motor local</h1>
      </div>

      <div className="panel" style={{ padding: 12, borderColor: done ? "color-mix(in oklch, var(--success) 30%, var(--border))" : "color-mix(in oklch, var(--warning) 26%, var(--border))" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 32, height: 32, borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: done ? "var(--success)" : "var(--warning)", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 16v-4" /><path d="M12 8h.01" /><path d="M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>Instalação inicial — ~2,0 GB</h3>
            <p className="meta" style={{ margin: "2px 0 8px" }}>XTTS v2 + DPDFNet + vocoder. Download único, verifica SHA256 e fica offline.</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <span className="meta" style={{ padding: "2px 6px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>XTTS 1.4 GB</span>
              <span className="meta" style={{ padding: "2px 6px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)" }}>DPDFNet 0.6 GB</span>
              <span className="meta" style={{ padding: "2px 6px", borderRadius: "var(--radius)", background: done ? "color-mix(in oklch, var(--success) 16%, var(--elevated))" : "var(--elevated)", border: "1px solid var(--border)", color: done ? "var(--success)" : undefined }}>{done ? "Licença CPML ok" : "Licença CPML pendente"}</span>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "default", marginBottom: 8 }}>
              <input type="checkbox" checked={licenseOk} onChange={(e) => setLicenseOk(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
              <span className="meta" style={{ color: "var(--fg)" }}>Li e aceito a licença CPML para uso local</span>
            </label>
            <div className={`fill ${!done ? "warn" : ""}`}><i style={{ width: `${pct}%`, background: done ? "var(--success)" : undefined }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }} className="meta">
              <span>{done ? "Pronto para uso ✓" : downloading ? assetsProgress?.file ?? "Baixando…" : "Pronto para baixar"}</span><span className="num">{pct}%</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
              <button className="btn btn-primary" disabled={(!licenseOk && !done) || downloading} onClick={downloadAssets}>
                {downloading ? "Baixando…" : done ? "Instalado ✓" : "Baixar ~2,0 GB"}
              </button>
              <span className="meta">WebSocket persiste entre abas</span>
            </div>
            {error && <div className="meta" style={{ marginTop: 8, color: "var(--error)" }}>{error}</div>}
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 12 }}>
        <span className="label-mono">Checklist técnico</span>
        <div style={{ marginTop: 6 }}>
          <div className="step">
            <span className={`check ${downloading ? "active" : done ? "done" : ""}`}>{done ? "✓" : "1"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Baixando arquivos</div>
              <div className="meta">WebSocket · barra fina no header</div>
            </div>
            <span className="meta num">{downloading ? `${pct}%` : done ? "ok" : "—"}</span>
          </div>
          <div className="step">
            <span className={`check ${done ? "done" : ""}`}>{done ? "✓" : "2"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Verificando SHA256</div>
              <div className="meta">Hash local vs. manifesto</div>
            </div>
            <span className="meta num" style={{ color: done ? "var(--success)" : undefined }}>{done ? "✓" : "#52525B"}</span>
          </div>
          <div className="step">
            <span className={`check ${done ? "done" : ""}`}>{done ? "✓" : "3"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>Pronto para uso</div>
              <div className="meta">XTTS e DPDFNet · sidecar 8765</div>
            </div>
            {done && <span className="meta" style={{ color: "var(--success)" }}>● Instalado</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="panel" style={{ padding: 12 }}>
          <span className="label-mono">Preferências</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            <label className="field"><span>Diretório de modelos</span><input className="input mono" value="~/.zorrilho/models" readOnly /></label>
            <label className="field"><span>Porta do sidecar</span><input className="input num" value="8765" readOnly /></label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "default" }}><input type="checkbox" defaultChecked style={{ accentColor: "var(--accent)" }} /><span className="meta" style={{ color: "var(--fg)" }}>Polling leve de saúde</span></label>
          </div>
        </div>
        <div className="panel" style={{ padding: 12 }}>
          <span className="label-mono">Saúde do sidecar</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }} className="meta">
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Endpoint</span><span className="num" style={{ color: "var(--fg)" }}>localhost:8765/health</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Status</span><span className="num" style={{ color: health.status === "ok" ? "var(--success)" : health.status === "loading" ? "var(--warning)" : "var(--error)" }}>{health.status}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Banco</span><span className="num" style={{ color: "var(--fg)" }}>{health.db ? health.db.split("/").pop() : "—"}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Modelos</span><span className="num" style={{ color: health.hushmic_assets ? "var(--success)" : "var(--warning)" }}>{health.hushmic_assets ? "Pronto" : "Pendente 2,0 GB"}</span></div>
            <div style={{ marginTop: 4, padding: "8px 9px", borderRadius: "var(--radius)", background: "var(--elevated)", border: "1px solid var(--border)", fontSize: 10, lineHeight: 1.5 }}>GET /health → {health.status === "ok" ? "200" : "…"} · polling a cada 8s sem bloquear UI.</div>
            <button className="btn btn-secondary" style={{ marginTop: 4 }} onClick={refresh}>↻ Recarregar</button>
          </div>
        </div>
      </div>

      <div className="meta" style={{ fontSize: 11 }}>
        Zorrilho — clonagem de voz local. Denoising:{" "}
        <a href="https://github.com/Fovty/hushmic" style={{ color: "var(--accent)", textDecoration: "underline" }} target="_blank" rel="noreferrer">HushMic</a> (DPDFNet, Apache-2.0). TTS:{" "}
        <a href="https://coqui.ai/cpml" style={{ color: "var(--accent)", textDecoration: "underline" }} target="_blank" rel="noreferrer">XTTS v2</a> (CPML, uso não-comercial).
      </div>
    </div>
  );
}
