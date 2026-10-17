import { useEffect } from "react";
import { useStore } from "../lib/store";
import { generationAudioUrl, exportUrl } from "../lib/sidecar";

export default function ProjetosTab() {
  const { profiles, selectedProfile, setSelectedProfile, generations, refreshGenerations, removeProfile } = useStore();

  useEffect(() => {
    refreshGenerations();
  }, [selectedProfile, refreshGenerations]);

  const selected = profiles.find((p) => p.id === selectedProfile) ?? null;

  return (
    <div className="pane-inner" style={{ padding: 12, gap: 10, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div>
          <p className="eyebrow">Biblioteca · local first</p>
          <h1 style={{ marginTop: 2 }}>Perfis e gerações</h1>
        </div>
        <span className="meta num">{profiles.length} perfis</span>
      </div>

      <div className="split-pane">
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--border)" }}>
          <div className="side-head">
            <span className="label-mono">Perfis</span>
            <span className="meta num">{profiles.length}</span>
          </div>
          <div className="side-list" style={{ flex: 1, overflow: "auto" }}>
            {profiles.length === 0 ? (
              <div className="meta" style={{ padding: 14, textAlign: "center", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}>Nenhum perfil ainda. Grave na aba Clonar.</div>
            ) : profiles.map((p) => {
              const active = p.id === selectedProfile;
              const initials = p.name.slice(0, 2).toUpperCase();
              return (
                <button
                  key={p.id}
                  className={`profile-row ${active ? "active" : ""}`}
                  style={{ width: "100%", textAlign: "left", cursor: "default" }}
                  onClick={() => setSelectedProfile(p.id)}
                >
                  <span className="avatar">{initials}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span className="meta num" style={{ fontSize: 9 }}>{p.engine} · {p.id.slice(0, 8)}</span>
                  </span>
                  {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="side-head">
            <span className="label-mono">{selected ? selected.name : "Selecione um perfil"}</span>
            <span className="meta num">{selected ? `${generations.length} gerações` : "—"}</span>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {!selected ? (
              <div className="meta" style={{ padding: 18, textAlign: "center", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}>As gerações deste perfil aparecerão aqui.</div>
            ) : generations.length === 0 ? (
              <div className="meta" style={{ padding: 18, textAlign: "center", border: "1px dashed var(--border)", borderRadius: "var(--radius)" }}>Nenhuma geração ainda para este perfil.</div>
            ) : generations.map((g) => (
              <div key={g.id} className="gen-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span className="meta num" style={{ color: "var(--fg)" }}>{new Date(g.created_at).toLocaleString()}</span>
                  <span className="meta num">{g.engine} · {Math.round(g.duration_ms / 100) / 10}s</span>
                </div>
                <div className="clamp2" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>{g.text}</div>
                <audio controls src={generationAudioUrl(g.id)} style={{ width: "100%", height: 28, display: "none" }} />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <audio src={generationAudioUrl(g.id)} controls style={{ flex: 1, height: 28 }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <a href={exportUrl(g.id, "wav")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none", height: 24, fontSize: 11 }}>WAV</a>
                  <a href={exportUrl(g.id, "mp3")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none", height: 24, fontSize: 11 }}>MP3</a>
                </div>
              </div>
            ))}
            {selected && generations.length > 0 && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 4, color: "var(--error)", borderColor: "color-mix(in oklch, var(--error) 30%, var(--border))" }}
                onClick={() => { if (confirm("Excluir este perfil e suas referências?")) removeProfile(); }}
              >
                Excluir perfil
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
