import { useEffect, useRef, useState } from "react";
import {
  fetchProfiles,
  createProfile,
  deleteProfile,
  fetchGenerations,
  ensureAssets,
  watchProgress,
  fetchHealth,
  generate as generateTask,
} from "../lib/sidecar";
import type { Profile, Generation, ProgressEvent } from "../lib/sidecar";
import { invoke } from "@tauri-apps/api/core";

export async function getInitialState() {
  try {
    const health = await fetchHealth();
    const profiles = await fetchProfiles();
    return { health, profiles };
  } catch (e) {
    console.error("falha ao buscar estado inicial:", e);
    return { health: { status: "error", db: "", models_dir: "", hushmic_assets: false }, profiles: [] };
  }
}

export function useSidecar() {
  const [health, setHealth] = useState<{
    status: string;
    db: string;
    models_dir: string;
    hushmic_assets: boolean;
  }>({ status: "loading", db: "", models_dir: "", hushmic_assets: false });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"clonar" | "estudio" | "projetos" | "config">("clonar");
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [assetsProgress, setAssetsProgress] = useState<{ done: number; total: number; file: string } | null>(
    null
  );
  const wsRef = useRef<() => void | null>(null);

  // gravação via comandos Tauri ( áudio → denoising )
  const startRecording = async () => {
    setError(null);
    try {
      await invoke("record_start");
      setRecording(true);
    } catch (e) {
      setError(`Erro ao iniciar gravação: ${e}`);
    }
  };

  const stopRecording = async () => {
    setError(null);
    try {
      const path = await invoke<string>("record_stop");
      const bytes = await invoke<Uint8Array>("read_file", { path });
      setRecording(false);
      return bytes;
    } catch (e) {
      setError(`Erro ao parar gravação: ${e}`);
      setRecording(false);
      throw e;
    }
  };

  const isRecording = () => invoke<boolean>("is_recording");

  // listagens
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const health = await fetchHealth();
        setHealth(health);
        const profiles = await fetchProfiles();
        setProfiles(profiles);
      } catch (e) {
        setError(`Erro ao buscar dados: ${e}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      const load = async () => {
        try {
          const gens = await fetchGenerations(selectedProfile);
          setGenerations(gens);
        } catch (e) {
          setError(`Erro ao buscar histórico: ${e}`);
        }
      };
      load();
    } else {
      setGenerations([]);
    }
  }, [selectedProfile]);

  const createNewProfile = async (wavBytes: Uint8Array, name: string, refText?: string) => {
    setError(null);
    setLoading(true);
    try {
      await createProfile(name, wavBytes, "xtts_v2", refText);
      const profiles = await fetchProfiles();
      setProfiles(profiles);
      if (profiles.length > 0) setSelectedProfile(profiles[0].id);
    } catch (e) {
      setError(`Erro ao criar perfil: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedProfile) return;
    setError(null);
    setLoading(true);
    try {
      await deleteProfile(selectedProfile);
      setProfiles([]);
      setSelectedProfile(null);
      setGenerations([]);
    } catch (e) {
      setError(`Erro ao excluir perfil: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const generateAudio = async () => {
    if (!selectedProfile || !text.trim()) {
      setError("Selecione um perfil e digite um texto.");
      return null;
    }
    setError(null);
    setLoading(true);
    setProgress(null);
    try {
      const taskId = await generateTask(text, selectedProfile, "pt");
      const cleanup = watchProgress(taskId, (ev) => {
        setProgress(ev);
        if (ev.stage === "done") {
          cleanup();
        }
      });
      wsRef.current = cleanup;
      const gid = await new Promise<string>((resolve, reject) => {
        const check = setInterval(async () => {
          const gens = await fetchGenerations(selectedProfile);
          const latest = gens
            .filter((g) => g.output_path)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          if (latest) {
            clearInterval(check);
            resolve(latest.id);
          }
        }, 1000);
        setTimeout(() => {
          clearInterval(check);
          reject(new Error("timeout esperando áudio gerado"));
        }, 30000);
      });
      setGenerations(await fetchGenerations(selectedProfile));
      return gid;
    } catch (e) {
      setError(`Erro ao gerar áudio: ${e}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const ensureHushmicAssets = async () => {
    setError(null);
    setAssetsProgress({ done: 0, total: 2, file: "inicando" });
    try {
      await ensureAssets();
      setAssetsProgress({ done: 2, total: 2, file: "concluido" });
    } catch (e) {
      setError(`Erro ao baixar assets: ${e}`);
      setAssetsProgress(null);
    }
  };

  return {
    health,
    profiles,
    generations,
    loading,
    error,
    selectedTab,
    setSelectedTab,
    selectedProfile,
    setSelectedProfile,
    text,
    setText,
    recording,
    startRecording,
    stopRecording,
    isRecording,
    deleteSelected,
    createNewProfile,
    generateAudio,
    progress,
    assetsProgress,
    ensureHushmicAssets,
  };
}