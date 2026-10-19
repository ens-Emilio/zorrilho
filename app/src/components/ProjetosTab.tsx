import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { finetuneStatus, finetuneVoice } from "../lib/sidecar";
import AudioPlayer from "./AudioPlayer";
import ZorrilhoIcon from "./ZorrilhoIcon";

export default function ProjetosTab() {
  const { profiles, selectedProfile, setSelectedProfile, generations, refreshGenerations, removeProfile, setActiveTab, setText } = useStore();
  const [q, setQ] = useState("");
  const [sortNewest, setSortNewest] = useState(true);
  const [page, setPage] = useState(0);
  const [deleted, setDeleted] = useState<{id:string;name:string}|null>(null);
  const [finetuneInfo, setFinetuneInfo] = useState<any>(null);

  useEffect(() => {
    refreshGenerations();
  }, [selectedProfile, refreshGenerations]);

  useEffect(() => { setPage(0); }, [q, selectedProfile, sortNewest]);

  useEffect(() => {
    if (!selectedProfile) { setFinetuneInfo(null); return; }
    finetuneStatus(selectedProfile).then(setFinetuneInfo).catch(()=> setFinetuneInfo(null));
  }, [selectedProfile]);

  const selected = profiles.find((p) => p.id === selectedProfile) ?? null;
  const filtered = profiles.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.engine.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...filtered].sort((a,b)=> sortNewest ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
  const pageSize = 20;
  const paged = sorted.slice(page*pageSize, (page+1)*pageSize);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

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
          <div className="side-head" style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <span className="label-mono">Perfis</span>
            <span className="meta num">{filtered.length}/{profiles.length}</span>
            <input className="input" placeholder="Buscar nome/engine" value={q} onChange={e=>setQ(e.target.value)} style={{height:24, flex:1, minWidth:100, fontSize:11}} />
            <button className="btn btn-ghost" style={{height:24, fontSize:10, padding:"0 6px"}} onClick={()=> setSortNewest(v=>!v)}>{sortNewest ? "Mais novos" : "Mais antigos"}</button>
          </div>
          {sorted.length > pageSize && (
            <div style={{display:"flex",gap:6,alignItems:"center",padding:"4px 8px"}} className="meta">
              <button className="btn btn-ghost" style={{height:22, fontSize:10}} disabled={page===0} onClick={()=> setPage(p=> Math.max(0,p-1))}>‹</button>
              <span className="meta num" style={{fontSize:10}}>{page+1}/{totalPages}</span>
              <button className="btn btn-ghost" style={{height:22, fontSize:10}} disabled={page+1>=totalPages} onClick={()=> setPage(p=> p+1)}>›</button>
            </div>
          )}
          <div className="side-list" style={{ flex: 1, overflow: "auto" }}>
            {filtered.length === 0 ? (
              <div className="meta" style={{ padding: 18, textAlign: "center", border: "1px dashed var(--border)", borderRadius: "var(--radius)", display: "grid", placeItems: "center", gap: 8 }}>{q ? <span>Nenhum resultado para "{q}"</span> : <><ZorrilhoIcon size={42} style={{ opacity: 0.85 }} /><span>Nenhum perfil ainda. Grave na aba Clonar.</span></>}</div>
            ) : paged.map((p) => {
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
          {deleted && (
            <div style={{padding:"6px 8px",borderTop:"1px solid var(--border)",display:"flex",gap:6,alignItems:"center",background:"color-mix(in oklch, var(--warning) 8%, var(--surface))"}}>
              <span className="meta" style={{fontSize:11}}>Perfil "{deleted.name}" excluído</span>
              <span className="meta" style={{fontSize:10}}>(sem undo — recrie via Clonar)</span>
              <button className="btn btn-ghost" style={{marginLeft:"auto",height:22,fontSize:10}} onClick={()=> setDeleted(null)}>Fechar</button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="side-head" style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <span className="label-mono">{selected ? selected.name : "Selecione um perfil"}</span>
            <span className="meta num">{selected ? `${generations.length} gerações` : "—"}</span>
            {selected && (
              <>
                <button className="btn btn-ghost" style={{height:22,fontSize:10}} onClick={()=> { setText(generations[0]?.text ?? ""); setActiveTab("estudio"); }}>Re-gerar no Estúdio →</button>
                <button className="btn btn-secondary" style={{height:22,fontSize:10}} onClick={async()=>{
                  try {
                    const j = await finetuneVoice(selected.id);
                    alert(`Finetune: ${j.job_id}`);
                    setFinetuneInfo(await finetuneStatus(selected.id));
                  } catch(e:any){ alert((e as Error).message); }
                }}>Treinar 95%</button>
              </>
            )}
          </div>
          {finetuneInfo && selected && (
            <div style={{padding:"6px 8px",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}} className="meta">
              <span style={{fontSize:10, color: finetuneInfo.finetune_status==="done" ? "var(--success)" : finetuneInfo.finetune_status==="training" ? "var(--warning)" : "var(--muted)"}}>Finetune: {finetuneInfo.finetune_status ?? "não treinado"} {finetuneInfo.ref_duration ? `· ref ${Math.round(finetuneInfo.ref_duration)}s` : ""}</span>
              {finetuneInfo.finetune_status==="error" && <span style={{fontSize:10, color:"var(--error)"}}>· erro</span>}
              {(!finetuneInfo.finetune_status || finetuneInfo.finetune_status==="error") && finetuneInfo.ref_duration && finetuneInfo.ref_duration < 60 && (
                <span style={{fontSize:10, color:"var(--warning)"}}>· precisa 60s limpo (tem {Math.round(finetuneInfo.ref_duration)}s) — importe mais</span>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {!selected ? (
              <div className="meta" style={{ padding: 18, textAlign: "center", border: "1px dashed var(--border)", borderRadius: "var(--radius)", display: "grid", placeItems: "center", gap: 8 }}><ZorrilhoIcon size={40} style={{ opacity: 0.12 }} /><span>As gerações deste perfil aparecerão aqui.</span></div>
            ) : generations.length === 0 ? (
              <div className="meta" style={{ padding: 18, textAlign: "center", border: "1px dashed var(--border)", borderRadius: "var(--radius)", display: "grid", placeItems: "center", gap: 8 }}><ZorrilhoIcon size={40} style={{ opacity: 0.12 }} /><span>Nenhuma geração ainda para este perfil.</span><button className="btn btn-secondary" style={{fontSize:11}} onClick={()=> setActiveTab("estudio")}>Gerar primeira fala →</button></div>
            ) : generations.map((g) => (
              <div key={g.id} className="gen-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span className="meta num" style={{ color: "var(--fg)" }}>{new Date(g.created_at).toLocaleString()}</span>
                  <span className="meta num">{g.engine} · {Math.round(g.duration_ms / 100) / 10}s</span>
                </div>
                <div className="clamp2" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>{g.text}</div>
                <div style={{height:4, borderRadius:4, background:"var(--elevated)", border:"1px solid var(--border)", overflow:"hidden", marginBottom:4}}><i style={{display:"block", height:"100%", width:"100%", background:"var(--accent)", opacity:0.55}} /></div>
                <AudioPlayer gid={g.id} />
              </div>
            ))}
            {selected && (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 4, color: "var(--error)", borderColor: "color-mix(in oklch, var(--error) 30%, var(--border))" }}
                onClick={() => { if (confirm(`Excluir "${selected.name}" e ${generations.length} gerações?`)) { const n=selected.name; removeProfile().then(()=> setDeleted({id: selected.id, name:n})); } }}
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
