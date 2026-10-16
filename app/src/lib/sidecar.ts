// Cliente do sidecar FastAPI ( HTTP + WS ). Porta fixa em dev; no build vem do spawn.
export const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://localhost:8765";

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
  onEvent: (ev: ProgressEvent) => void
): () => void {
  const wsUrl = SIDECAR_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/ws/progress/${taskId}`);
  ws.onmessage = (ev) => onEvent(JSON.parse(ev.data));
  return () => ws.close();
}

export async function ensureAssets(): Promise<{ status: string; events: unknown[] }> {
  const res = await fetch(`${SIDECAR_URL}/api/assets/ensure`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function generationAudioUrl(gid: string): string {
  return `${SIDECAR_URL}/api/generations/${gid}/audio`;
}
