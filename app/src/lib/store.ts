// Store central (zustand) — único estado compartilhado entre todas as abas.
import { create } from "zustand";
import {
  fetchHealth,
  fetchProfiles,
  fetchGenerations,
  createProfile,
  createProfileBatch,
  deleteProfile,
  ensureAssets,
  watchProgress,
  generate as generateTask,
} from "./sidecar";
import type { Profile, Generation, Health, ProgressEvent } from "./sidecar";

export type TabId = "clonar" | "estudio" | "projetos" | "config";

interface SidecarState {
  health: Health;
  profiles: Profile[];
  generations: Generation[];
  selectedProfile: string | null;
  text: string;
  recording: boolean;
  refWav: Uint8Array | null;
  refFileName: string | null;
  refFiles: { bytes: Uint8Array; filename: string }[] | null;
  selectedEngine: string;
  progress: ProgressEvent | null;
  assetsProgress: { done: number; total: number; file: string } | null;
  loading: boolean;
  error: string | null;
  lastGenerationId: string | null;
  activeTab: TabId;

  setActiveTab: (t: TabId) => void;
  setHealth: (h: Health) => void;
  setProfiles: (p: Profile[]) => void;
  setSelectedProfile: (id: string | null) => void;
  setText: (t: string) => void;
  setRecording: (r: boolean) => void;
  setRefWav: (w: Uint8Array | null) => void;
  setRefFileName: (n: string | null) => void;
  setRefFiles: (f: { bytes: Uint8Array; filename: string }[] | null) => void;
  setSelectedEngine: (e: string) => void;
  setError: (e: string | null) => void;

  refresh: () => Promise<void>;
  refreshGenerations: () => Promise<void>;
  newProfile: (name: string, refText?: string) => Promise<void>;
  removeProfile: () => Promise<void>;
  runGenerate: (opts?: { engineOverride?: string; language?: string }) => Promise<string | null>;
  downloadAssets: () => Promise<void>;
}

export const useStore = create<SidecarState>((set, get) => ({
  health: { status: "loading", db: "", models_dir: "", hushmic_assets: false },
  profiles: [],
  generations: [],
  selectedProfile: null,
  text: "",
  recording: false,
  refWav: null,
  refFileName: null,
  refFiles: null,
  selectedEngine: "xtts_v2",
  progress: null,
  assetsProgress: null,
  loading: false,
  error: null,
  lastGenerationId: null,
  activeTab: "clonar",

  setActiveTab: (t) => set({ activeTab: t }),
  setHealth: (h) => set({ health: h }),
  setProfiles: (p) => set({ profiles: p }),
  setSelectedProfile: (id) => set({ selectedProfile: id }),
  setText: (t) => set({ text: t }),
  setRecording: (r) => set({ recording: r }),
  setRefWav: (w) => set({ refWav: w }),
  setRefFileName: (n) => set({ refFileName: n }),
  setRefFiles: (f) => set({ refFiles: f }),
  setSelectedEngine: (e) => set({ selectedEngine: e }),
  setError: (e) => set({ error: e }),
  refresh: async () => {
    try {
      const health = await fetchHealth();
      // health can throw ERR_CONNECTION_REFUSED while sidecar restarts — don't mask it
      if (!health || typeof health.status !== "string") throw new Error("health inválido");
      set({ health, error: null });
      try {
        const profiles = await fetchProfiles();
        set({ profiles });
      } catch (e) {
        // profiles é secundário — health já prova que sidecar está vivo
        console.warn("[zorrilho] fetchProfiles falhou:", e);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isConnRefused = msg.includes("Failed to fetch") || msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("NetworkError");
      set({
        error: isConnRefused ? "Sidecar offline — reiniciando... (porta 8765)" : `Erro ao buscar dados do sidecar: ${msg}`,
        health: { ...get().health, status: isConnRefused ? "offline" : "erro" },
      });
    }
  },

  refreshGenerations: async () => {
    const pid = get().selectedProfile;
    if (!pid) return set({ generations: [] });
    try {
      set({ generations: await fetchGenerations(pid) });
    } catch {
      set({ generations: [] });
    }
  },
  newProfile: async (name, refText) => {
    const files = get().refFiles;
    const wav = get().refWav;
    if (files && files.length > 1) {
      set({ loading: true, error: null });
      try {
        const p = await createProfileBatch(name, files, "xtts_v2", refText);
        await get().refresh();
        set({ selectedProfile: p.id, refWav: null, refFileName: null, refFiles: null });
      } catch (e) {
        set({ error: `Erro ao criar perfil: ${e}` });
      } finally {
        set({ loading: false });
      }
      return;
    }
    if (!wav) return set({ error: "Grave uma amostra ou importe arquivos primeiro." });
    set({ loading: true, error: null });
    try {
      const fname = get().refFileName ?? "ref.wav";
      const p = await createProfile(name, wav, "xtts_v2", refText, fname);
      await get().refresh();
      set({ selectedProfile: p.id, refWav: null, refFileName: null, refFiles: null });
    } catch (e) {
      set({ error: `Erro ao criar perfil: ${e}` });
    } finally {
      set({ loading: false });
    }
  },

  removeProfile: async () => {
    const pid = get().selectedProfile;
    if (!pid) return;
    set({ loading: true, error: null });
    try {
      await deleteProfile(pid);
      set({ selectedProfile: null, generations: [] });
      await get().refresh();
    } catch (e) {
      set({ error: `Erro ao excluir perfil: ${e}` });
    } finally {
      set({ loading: false });
    }
  },

  runGenerate: async (opts) => {
    const { selectedProfile, text } = get();
    if (!selectedProfile || !text.trim()) {
      set({ error: "Selecione um perfil e digite um texto." });
      return null;
    }
    set({ loading: true, error: null, progress: null, lastGenerationId: null });
    try {
      const taskId = await generateTask(text, selectedProfile, opts?.language ?? "pt", opts?.engineOverride);
      return await new Promise<string>((resolve, reject) => {
        let done = false;
        const finish = (err?: Error, gid?: string) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cleanup();
          set({ loading: false });
          if (err) {
            set({ error: err.message });
            reject(err);
          } else if (gid) {
            set({ lastGenerationId: gid });
            get().refreshGenerations();
            resolve(gid);
          }
        };
        const timer = setTimeout(() => finish(new Error("generate timeout (5min)")), 5 * 60 * 1000);
        const cleanup = watchProgress(
          taskId,
          (ev) => {
            set({ progress: ev });
            if (ev.stage === "done" && ev.generation_id) {
              finish(undefined, ev.generation_id);
            } else if (ev.stage === "error") {
              finish(new Error(ev.error ?? "erro desconhecido"));
            }
          },
          () => finish(new Error("WS connection error"))
        );
      });
    } catch (e) {
      set({ error: `Erro ao gerar: ${e}`, loading: false });
      return null;
    }
  },

  downloadAssets: async () => {
    set({ error: null, assetsProgress: { done: 0, total: 2, file: "iniciando" } });
    try {
      await ensureAssets();
      set({ assetsProgress: { done: 2, total: 2, file: "concluido" } });
      await get().refresh();
    } catch (e) {
      set({ error: `Erro ao baixar assets: ${e}`, assetsProgress: null });
    }
  },
}));
