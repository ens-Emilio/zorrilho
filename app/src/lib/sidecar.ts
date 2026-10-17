// Cliente do sidecar FastAPI (HTTP + WS). Porta fixa em dev; no build vem do spawn.
// In Vite dev (5173) use relative URL -> Vite proxy (vite.config.ts) avoids CORS/ERR_CONNECTION_REFUSED.
// In Tauri prod or direct dev, fall back to localhost:8765.
export const SIDECAR_URL = (() => {
  const env = (import.meta.env as Record<string, string | undefined>).VITE_SIDECAR_URL;
  if (env) return env;
  if (typeof window !== "undefined" && window.location.port === "5173") return "";
  return "http://localhost:8765";
})();

export interface Profile {
  id: string;
  name: string;
  kind: string;
  engine: string;
  ref_audio_path: string | null;
  ref_text: string | null;
  created_at: string;
}

export interface Health {
  status: string;
  db: string;
  models_dir: string;
  hushmic_assets: boolean;
}

export interface Generation {
  id: string;
  voice_profile_id: string;
  text: string;
  output_path: string | null;
  engine: string;
  duration_ms: number;
  created_at: string;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${SIDECAR_URL}/health`);
  return res.json();
}

export async function fetchProfiles(): Promise<Profile[]> {
  const res = await fetch(`${SIDECAR_URL}/api/profiles`);
  return res.json();
}

export async function createProfile(
  name: string,
  wavBytes: Uint8Array,
  engine = "xtts_v2",
  refText?: string
): Promise<{ id: string; name: string; engine: string }> {
  const blob = new Blob([wavBytes as BlobPart], { type: "audio/wav" });
  const fd = new FormData();
  fd.append("name", name);
  fd.append("engine", engine);
  if (refText) fd.append("ref_text", refText);
  fd.append("ref_audio", blob, "ref.wav");
  const res = await fetch(`${SIDECAR_URL}/api/profiles`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProfile(id: string): Promise<void> {
  const res = await fetch(`${SIDECAR_URL}/api/profiles/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchGenerations(profileId?: string): Promise<Generation[]> {
  const url = profileId
    ? `${SIDECAR_URL}/api/generations?profile_id=${profileId}`
    : `${SIDECAR_URL}/api/generations`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

export async function generate(
  text: string,
  profileId: string,
  language = "pt"
): Promise<string> {
  const res = await fetch(`${SIDECAR_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, profile_id: profileId, language }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.task_id as string;
}

export interface ProgressEvent {
  stage: string;
  progress: number;
  generation_id?: string;
  output_path?: string;
  duration_ms?: number;
  elapsed_s?: number;
  error?: string;
}

/** Abre WS de progresso de uma task. onEvent recebe cada evento; retorna cleanup. */
export function watchProgress(
  taskId: string,
  onEvent: (ev: ProgressEvent) => void,
  onError?: (e: Event) => void
): () => void {
  // Se SIDECAR_URL for vazio (Vite proxy), deriva do location; caso contrário usa o próprio SIDECAR_URL
  const base = SIDECAR_URL
    ? SIDECAR_URL.replace(/^http/, "ws")
    : `ws://${window.location.host}${window.location.port === "5173" ? ":8765" : ""}`;
  const ws = new WebSocket(`${base}/ws/progress/${taskId}`);
  let closed = false;
  const timer = window.setTimeout(() => {
    if (!closed) {
      closed = true;
      ws.close();
      onEvent({ stage: "error", progress: 0, error: "watchProgress timeout (5min)" });
    }
  }, 5 * 60 * 1000);

  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      onEvent({ stage: "error", progress: 0, error: "WS parse failed" });
    }
  };
  ws.onerror = (e) => {
    if (!closed) {
      closed = true;
      clearTimeout(timer);
      onError?.(e);
      onEvent({ stage: "error", progress: 0, error: "WS connection error" });
    }
  };
  ws.onclose = () => {
    if (!closed) {
      closed = true;
      clearTimeout(timer);
      onEvent({ stage: "error", progress: 0, error: "WS closed unexpectedly" });
    }
  };
  return () => {
    if (!closed) {
      closed = true;
      clearTimeout(timer);
      ws.close();
    }
  };
}

export async function ensureAssets(): Promise<{ status: string; events: unknown[] }> {
  const res = await fetch(`${SIDECAR_URL}/api/assets/ensure`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function generationAudioUrl(gid: string): string {
  return `${SIDECAR_URL}/api/generations/${gid}/audio`;
}

export function exportUrl(gid: string, format: "wav" | "mp3"): string {
  return `${SIDECAR_URL}/api/generations/${gid}/export?format=${format}`;
}
