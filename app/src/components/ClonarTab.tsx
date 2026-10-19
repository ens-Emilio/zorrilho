import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { exportUrl, preprocess, finetuneVoice } from "../lib/sidecar";
import { invoke } from "@tauri-apps/api/core";

export default function ClonarTab() {
  const {
    recording, setRecording, refWav, setRefWav, setRefFileName, refFileName,
    profiles: _unused, setError, newProfile, error,
  } = useStore();
  const selectedEngine = useStore(s=> (s as any).selectedEngine ?? "xtts_v2");
  const [timer, setTimer] = useState(0);
  const [name, setName] = useState("");
  const [denoising, setDenoising] = useState(false);
  const [importing, setImporting] = useState(false);
  const timerRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (recording) {
      timerRef.current = window.setInterval(() => setTimer((s) => s + 0.1), 100);
    } else {
      clearInterval(timerRef.current);
    }
    return () => { clearInterval(timerRef.current); };
  }, [recording]);

  const capture: "idle" | "recording" | "denoising" | "ready" =
    refWav && !recording ? "ready" : denoising ? "denoising" : recording ? "recording" : "idle";
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
      } else {
        setDenoising(true);
        const path = await invoke<string>("record_stop");
        const bytes = await invoke<number[]>("read_file", { path });
        setRefWav(new Uint8Array(bytes));
        setRefFileName("ref.wav");
        setRecording(false);
        setDenoising(false);
      }
    } catch (e) {
      setError(`Gravação: ${e}`);
      setRecording(false);
      setDenoising(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
    if (list.length > 10) {
      setError("Máximo 10 arquivos por vez");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    for (const f of list) {
      if (f.size === 0) {
        setError(`${f.name}: arquivo vazio`);
        return;
      }
    }
    setError(null);
    setImporting(true);
    try {
      const { setRefFiles } = useStore.getState();
      if (list.length === 1) {
        const buf = new Uint8Array(await list[0].arrayBuffer());
        setRefWav(buf);
        setRefFileName(list[0].name);
        setRefFiles(null);
        if (!cleanEnabled) { setPreSegments(null); return; }
        setPreLoading(true);
        preprocess([{bytes: buf, filename: list[0].name}]).then(r=>{
          setPreSegments(r.segments);
          const choice: Record<number,string>={}; r.segments.forEach((s:any)=> { const rec = typeof s.recommended === "boolean" ? (s.recommended ? "clean" : "original") : (s.recommended_str ?? s.recommended); choice[s.idx]=rec; }); setPreChoice(choice as any);
          const s=r.segments[0];
          if(s && s.recommended==="clean" && s.wav_b64_clean){
            try{ const bin=atob(s.wav_b64_clean); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); setRefWav(bytes); setRefFileName("limpo: "+list[0].name); }catch{}
          }
        }).catch(e=> setError(`Pré-processamento: ${e}`)).finally(()=> setPreLoading(false));
      } else {
        const arr = await Promise.all(list.map(async (f) => ({ bytes: new Uint8Array(await f.arrayBuffer()), filename: f.name })));
        setRefFiles(arr);
        // keep first as preview + trigger preprocess for real clean preview
        setRefWav(arr[0].bytes);
        setRefFileName(`${list.length} arquivos`);
        // async preview (não bloqueia)
        if (!cleanEnabled) { setPreSegments(null); return; }
        setPreLoading(true);
        preprocess(arr).then(r=>{
          setPreSegments(r.segments);
          const choice: Record<number,string> = {};
          r.segments.forEach((s:any)=> { const rec = typeof s.recommended === "boolean" ? (s.recommended ? "clean" : "original") : (s.recommended_str ?? s.recommended); choice[s.idx]=rec; });
          setPreChoice(choice as any);
          // se limpo recomendado, usa limpo para clonar (decodifica base64)
          const best = r.segments[r.best_idx];
          if (best && best.recommended==="clean" && best.wav_b64_clean) {
            try {
              const bin = atob(best.wav_b64_clean);
              const bytes = new Uint8Array(bin.length);
              for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
              // usa limpo para o clonar efetivo
              setRefFiles([{bytes, filename: "clean.wav"}]);
            } catch {}
          }
        }).catch(e=> setError(`Pré-processamento: ${e}`)).finally(()=> setPreLoading(false));
      }
    } catch (err) {
      setError(`Falha ao ler arquivos: ${err}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const pct = Math.min(100, (timer / 6) * 100);
  const progress = useStore((s) => s.progress);
  const gid = progress?.generation_id ?? null;
  const loading = useStore((s) => s.loading);
  const profiles = useStore((s) => s.profiles);
  const lastCreated = profiles.length > 0 ? profiles[profiles.length - 1] : null;
  const [justCreated, setJustCreated] = useState<{id:string;name:string}|null>(null);
  const [preSegments, setPreSegments] = useState<any[]|null>(null);
  const [preChoice, setPreChoice] = useState<Record<number,"clean"|"original">>({});
  const [preLoading, setPreLoading] = useState(false);
  const [cleanEnabled, setCleanEnabled] = useState(true);
  const canCreate = name.trim().length >= 2 && !!refWav && !recording && !denoising && !loading;
  const createLabel = loading ? "Clonando..." : !refWav ? "Criar perfil — grave ou importe primeiro" : name.trim().length < 2 ? "Criar perfil — nome com ≥2 caracteres" : "✓ Clonar voz";

  async function handleCreate() {
    // se preview existe, materializa escolha antes de clonar
    if (preSegments && preSegments.length>0) {
      try {
        const chosen: {bytes:Uint8Array;filename:string}[]=[];
        for(const s of preSegments){
          const b64 = preChoice[s.idx]==="clean" ? s.wav_b64_clean : s.wav_b64_original;
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
          chosen.push({bytes, filename: s.filename.replace(/\.[^.]+$/, "")+".wav"});
        }
        if(chosen.length===1){ useStore.getState().setRefWav(chosen[0].bytes); useStore.getState().setRefFileName(chosen[0].filename); useStore.getState().setRefFiles(null); }
        else { useStore.getState().setRefFiles(chosen); }
        await new Promise(r=> setTimeout(r, 50));
      } catch(e){ setError(`Falha ao preparar áudio limpo: ${e}`); return; }
    }
    const before = new Set(profiles.map(p=>p.id));
    await newProfile(name);
    // detect newly created (store refreshes)
    setTimeout(()=>{
      const cur = useStore.getState().profiles;
      const created = cur.find(p=>!before.has(p.id));
      if (created) {
        setJustCreated(created);
        setName("");
        setTimeout(()=>setJustCreated(null), 8000);
      }
    }, 300);
  }

  const step = !refWav ? 1 : !name.trim() || name.trim().length < 2 ? 2 : 3;

  return (
    <div className="pane-inner pane-pad" style={{ gap: 12 }}>
      <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",padding:"6px 8px",borderRadius:"var(--radius)",background:"var(--elevated)",border:"1px solid var(--border)"}}>
        {([ [1,"Áudio"], [2,"Motor+Nome"], [3,"Clonar"]] as [number,string][]).map(([n,label])=> (
          <span key={n} style={{display:"flex",alignItems:"center",gap:6,opacity: step>=n?1:0.45}}>
            <span style={{width:18,height:18,borderRadius:"50%",display:"grid",placeItems:"center",fontSize:9,fontFamily:"var(--font-mono)",background: step>=n ? "var(--accent)" : "var(--border)", color:"#fff"}}>{n}</span>
            <span className="meta" style={{fontSize:10, color: step>=n ? "var(--fg)" : "var(--muted)"}}>{label}</span>
            {n<3 && <span style={{width:12,height:1,background:"var(--border)"}}/>}
          </span>
        ))}
        <span className="meta" style={{marginLeft:"auto",fontSize:10}}>{step===1 ? "Grave ou importe" : step===2 ? "Escolha motor + nome" : "Pronto para clonar →"}</span>
      </div>
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
                <span className="meta num" style={{ color: "var(--success)" }}>Voz pronta</span>
                <span className="meta num" style={{ marginLeft: "auto" }}>{fmt(refWav.length / 48000 / 2)} / {fmt(refWav.length / 48000 / 2)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setRefWav(null); setRefFileName(null); useStore.getState().setRefFiles(null); setTimer(0); }}>Descartar</button>
                <span className="meta" style={{ color: "var(--success)" }}>{refFileName ?? "48kHz"} · {(refWav.length / 1024).toFixed(1)} KB</span>
              </div>
              {gid && (
                <div style={{ display: "flex", gap: 6 }}>
                  <a href={exportUrl(gid, "wav")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none" }}>⬇ WAV</a>
                  <a href={exportUrl(gid, "mp3")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none" }}>⬇ MP3</a>
                </div>
              )}
            </div>
          )}

          {!recording && !denoising && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px", borderRadius: "var(--radius)", background: "var(--elevated)", border: `1px dashed ${refWav ? "var(--success)" : "var(--border)"}` }}>
              <span className="label-mono">{refWav ? "Trocar / adicionar arquivos" : "Ou importar arquivo"}</span>
              <span className="meta" style={{ fontSize: 11 }}>Vídeo (mp4/mov/mkv/webm) ou áudio (wav/mp3/m4a/ogg/flac). Selecione até 10 — serão concatenados. Dica: 1 voz limpa, 6–15s por arquivo.</span>
              <input ref={fileRef} type="file" multiple accept="audio/*,video/*,.mp4,.mkv,.mov,.webm,.avi,.m4a,.mp3,.wav,.ogg,.flac" onChange={handleFile} style={{ fontSize: 12 }} />
              {importing && <span className="meta" style={{ color: "var(--warning)" }}>Lendo arquivo…</span>}
              {refWav && <span className="meta" style={{ color: "var(--success)", fontSize: 11 }}>✓ {refFileName} pronto — preencha o nome à direita e clique em Criar perfil</span>}
            </div>
          )}

          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}><input type="checkbox" checked={cleanEnabled} onChange={e=>{setCleanEnabled(e.target.checked); if(!e.target.checked) setPreSegments(null);}} /> Limpeza automática (DP DFNet · trim · loudnorm)</label>
          {preLoading && <div className="meta" style={{color:"var(--warning)"}}>Analisando e limpando áudio (DPDFNet)...</div>}
          {preSegments && preSegments.length>0 && (
            <div style={{display:"flex",flexDirection:"column",gap:8,padding:"10px",borderRadius:"var(--radius)",background:"var(--surface)",border:"1px solid var(--border)"}}>
              <span className="label-mono">Prévia: Original vs Limpo ({preSegments.length} arquivo(s))</span>
              {preSegments.map((s:any)=> (
                <div key={s.idx} style={{display:"flex",flexDirection:"column",gap:6,padding:"8px",borderRadius:"var(--radius)",background:"var(--elevated)",border:"1px solid var(--border)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <span className="meta" style={{fontWeight:600}}>{s.filename}</span>
                    <span className="meta" style={{fontSize:10, color: (s.snr_clean ?? 0) > (s.snr_raw ?? 0) ? "var(--success)" : "var(--muted)"}}>{s.duration_raw}s → {s.duration_clean}s · SNR {s.snr_raw}dB → {s.snr_clean}dB {s.did_denoise? "· DPDFNet": s.did_denoise===false? "· já limpo": ""} · clip {s.clipping_raw} → {s.clipping_clean}</span>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12}}><input type="radio" checked={preChoice[s.idx]==="original"} onChange={()=>setPreChoice({...preChoice,[s.idx]:"original"})} /> Original</label>
                    <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12}}><input type="radio" checked={preChoice[s.idx]==="clean"} onChange={()=>setPreChoice({...preChoice,[s.idx]:"clean"})} /> Limpo {(typeof s.recommended === "boolean" ? s.recommended : (s.recommended_str??s.recommended)==="clean") ? "✓ recomendado":""}</label>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <audio controls style={{flex:1, height:32}} src={`data:audio/wav;base64,${s.wav_b64_original}`} />
                    <audio controls style={{flex:1, height:32}} src={`data:audio/wav;base64,${s.wav_b64_clean}`} />
                  </div>
                </div>
              ))}
              <span className="meta" style={{fontSize:10}}>Limpo = denoise + trim silêncio + loudnorm. Escolha por arquivo; o clonar usará sua escolha.</span>
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
            <label htmlFor="engine">Motor — Passo 2</label>
            <select className="input" id="engine" value={selectedEngine} onChange={e=>useStore.getState().setSelectedEngine(e.target.value)}>
              <option value="xtts_v2">XTTS v2 — rápido, zero-shot (default)</option>
              <option value="f5_tts">F5-TTS — prosódia pt-BR (pip install f5-tts)</option>
              <option value="gpt_sovits" disabled>GPT-SoVITS v3 — finetune (requer treino, em breve)</option>
            </select>
            <span className="meta" style={{fontSize:10}}>{selectedEngine==="f5_tts" ? "pip install f5-tts" : selectedEngine==="gpt_sovits" ? "Stub — use xtts_v2/f5_tts" : "Offline sem deps extras"}</span>
          </div>

          <div className="field">
            <label htmlFor="profileName">Nome do perfil — Passo 3</label>
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

          <button className="btn btn-primary btn-block" disabled={!canCreate} onClick={() => canCreate && handleCreate()}>{loading ? <span style={{display:"inline-flex",alignItems:"center",gap:8}}><span style={{width:14,height:14,border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite"}}/> Clonando...</span> : createLabel}</button>
          {justCreated && (
            <div style={{padding:"10px 12px",borderRadius:"var(--radius)",background:"color-mix(in oklch, var(--success) 12%, var(--surface))",border:"1px solid color-mix(in oklch, var(--success) 40%, var(--border))",display:"flex",flexDirection:"column",gap:6}}>
              <span style={{fontSize:12,fontWeight:600,color:"var(--success)"}}>✓ Voz clonada: {justCreated.name}</span>
              <span className="meta" style={{fontSize:11}}>Perfil disponível na aba <b>Estúdio</b> para gerar falas. ID: {justCreated.id.slice(0,8)}…</span>
              <div style={{display:"flex",gap:6}}>
                <button className="btn btn-secondary" style={{flex:1,fontSize:12}} onClick={()=>{useStore.getState().setSelectedProfile(justCreated.id); useStore.getState().setActiveTab("estudio");}}>Ir para Estúdio →</button>
                <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setJustCreated(null)}>Fechar</button>
              </div>
            </div>
          )}
          {justCreated && (
            <div style={{padding:"10px",borderRadius:"var(--radius)",background:"var(--elevated)",border:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:6}}>
              <span className="label-mono">Alta fidelidade (opcional)</span>
              <span className="meta" style={{fontSize:11}}>Para voz 95% idêntica, treine finetune GPT-SoVITS (precisa 60s-10min de áudio limpo + GPU).</span>
              <button className="btn btn-secondary" style={{fontSize:12}} onClick={async()=>{
                try {
                  const j = await finetuneVoice(justCreated.id);
                  alert(`Treino iniciado: ${j.job_id}. Acompanhe em Projetos (WS progresso).`);
                } catch(e:any){ alert(`Finetune: ${e.message}`); }
              }}>Treinar finetune (60s+ limpo)</button>
            </div>
          )}
          {profiles.length > 0 && !justCreated && (
            <div className="meta" style={{fontSize:11,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{color:"var(--success)"}}>● {profiles.length} voz(es) clonada(s)</span>
              <span>— último: <b>{lastCreated?.name}</b></span>
              <button className="btn btn-ghost" style={{fontSize:11,padding:"2px 6px"}} onClick={()=>useStore.getState().setActiveTab("estudio")}>Ir para Estúdio</button>
            </div>
          )}

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
