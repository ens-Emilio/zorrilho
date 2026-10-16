// Store central (zustand) — único estado compartilhado entre todas as abas.
import { create } from "zustand";
import {
  fetchHealth,
  fetchProfiles,
  fetchGenerations,
  createProfile,
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
  setError: (e: string | null) => void;

  refresh: () => Promise<void>;
  refreshGenerations: () => Promise<void>;
  newProfile: (name: string, refText?: string) => Promise<void>;
  removeProfile: () => Promise<void>;
  runGenerate: () => Promise<string | null>;
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
  setError: (e) => set({ error: e }),

  refresh: async () => {
    try {
      const health = await fetchHealth();
      const profiles = await fetchProfiles();
      set({ health, profiles });
    } catch (e) {
      set({ error: `Erro ao buscar dados do sidecar: ${e}`, health: { ...get().health, status: "erro" } });
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
    const wav = get().refWav;
    if (!wav) return set({ error: "Grave uma amostra primeiro." });
    set({ loading: true, error: null });
    try {
      const p = await createProfile(name, wav, "xtts_v2", refText);
      await get().refresh();
      set({ selectedProfile: p.id, refWav: null });
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

  runGenerate: async () => {
    const { selectedProfile, text } = get();
    if (!selectedProfile || !text.trim()) {
      set({ error: "Selecione um perfil e digite um texto." });
      return null;
    }
    set({ loading: true, error: null, progress: null, lastGenerationId: null });
    try {
      const taskId = await generateTask(text, selectedProfile, "pt");
      return await new Promise<string>((resolve, reject) => {
        const cleanup = watchProgress(taskId, (ev) => {
          set({ progress: ev });
          if (ev.stage === "done" && ev.generation_id) {
            cleanup();
            set({ lastGenerationId: ev.generation_id, loading: false });
            get().refreshGenerations();
            resolve(ev.generation_id);
          } else if (ev.stage === "error") {
            cleanup();
            set({ error: ev.error ?? "erro desconhecido", loading: false });
            reject(new Error(ev.error));
          }
        });
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
