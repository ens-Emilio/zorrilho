import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const SIDECAR_URL = "http://localhost:8765";

function App() {
  const [recording, setRecording] = useState(false);
  const [refPath, setRefPath] = useState<string | null>(null);
  const [text, setText] = useState("Olá, isto é um teste.");
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    refreshProfiles();
    return () => wsRef.current?.close();
  }, []);

  async function refreshProfiles() {
    const res = await fetch(`${SIDECAR_URL}/api/profiles`);
    const list = await res.json();
    setProfiles(list);
    if (list.length > 0 && !selectedProfile) setSelectedProfile(list[0].id);
  }

  async function startRecording() {
    try {
      await invoke("record_start");
      setRecording(true);
      setStatus("Gravando com denoising HushMic...");
    } catch (e) {
      setStatus(`Erro: ${e}`);
    }
  }

  async function stopRecording() {
    try {
      const path = await invoke<string>("record_stop");
      setRefPath(path);
      setRecording(false);
      setStatus(`Referência salva: ${path}`);
    } catch (e) {
      setRecording(false);
      setStatus(`Erro: ${e}`);
    }
  }

  async function createProfile() {
    if (!refPath) return;
    // le o WAV do FS e envia ao sidecar
    setStatus("Enviando referência ao sidecar...");
    try {
      const bytes = await invoke<number[]>("read_file", { path: refPath });
      const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      const fd = new FormData();
      fd.append("name", `Perfil ${new Date().toLocaleTimeString()}`);
      fd.append("ref_audio", blob, "ref.wav");
      const res = await fetch(`${SIDECAR_URL}/api/profiles`, { method: "POST", body: fd });
      const profile = await res.json();
      await refreshProfiles();
      setSelectedProfile(profile.id);
      setStatus(`Perfil criado: ${profile.name}`);
    } catch (e) {
      setStatus(`Erro: ${e}`);
    }
  }

  async function generate() {
    if (!selectedProfile) return;
    setStatus("Gerando...");
    setProgress(null);
    const res = await fetch(`${SIDECAR_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, profile_id: selectedProfile, language: "pt" }),
    });
    const { task_id } = await res.json();
    setTaskId(task_id);

    const ws = new WebSocket(`ws://localhost:8765/ws/progress/${task_id}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      setProgress(data);
      if (data.stage === "done") {
        setAudioUrl(`${SIDECAR_URL}/api/generations/${data.generation_id}/audio`);
        setStatus("Concluído!");
        ws.close();
      } else if (data.stage === "error") {
        setStatus(`Erro: ${data.error}`);
        ws.close();
      }
    };
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>🦨 Zorrilho</h1>
      <p style={{ opacity: 0.7 }}>Clonagem de voz local — XTTS v2 + HushMic denoising</p>

      <section style={{ marginBottom: 24 }}>
        <h2>1. Gravar referência (com denoising)</h2>
        {recording ? (
          <button onClick={stopRecording}>⏹ Parar gravação</button>
        ) : (
          <button onClick={startRecording}>🎤 Gravar amostra de voz</button>
        )}
        {refPath && <p style={{ fontSize: 12 }}>Referência: {refPath}</p>}
        {refPath && <button onClick={createProfile}>Criar perfil com esta referência</button>}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>2. Gerar áudio</h2>
        <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <br /><br />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ width: "100%" }} />
        <br />
        <button onClick={generate} disabled={!selectedProfile}>▶ Gerar</button>
        {progress && (
          <p>{progress.stage} — {progress.progress}%</p>
        )}
      </section>

      {audioUrl && (
        <section>
          <h2>3. Resultado</h2>
          <audio controls src={audioUrl} />
        </section>
      )}

      <p style={{ fontSize: 12, opacity: 0.6 }}>{status}</p>
    </main>
  );
}

export default App;
