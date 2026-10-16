import { useSidecar } from "../lib/useSidecar";
import type { Profile } from "../lib/sidecar";
import { XMarkIcon } from "@heroicons/react/24/solid";
import { clsx } from "clsx";

export default function ClonarTab() {
  const {
    recording,
    loading,
    startRecording,
    stopRecording,
    profiles,
    selectedProfile,
    setSelectedProfile,
    text,
    setText,
    generateAudio,
    progress,
    error,
    assetsProgress,
    ensureHushmicAssets,
  } = useSidecar();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Clonar voz (com denoising HushMic)</h2>
        <p className="text-sm text-muted-foreground">
          Grave uma amostra de voz com redução de ruído em tempo real ou envie um arquivo.
        </p>
      </div>

      <div className="border rounded-lg p-4">
        <div className="flex items-center space-x-3 mb-3">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={recording === undefined}
            className={clsx(
              "px-4 py-2 rounded",
              recording ? "bg-red-600 text-white" : "bg-blue-600 text-white hover:bg-blue-700",
              recording === undefined && "opacity-50 cursor-not-allowed"
            )}
          >
            {recording ? "⏹ Parar gravação" : "🎤 Gravar amostra"}
          </button>
          {recording && <span className="text-xs text-muted-foreground">Gravando com denoising...</span>}
          {recording === undefined && <span className="text-xs text-muted-foreground">Tauri não pronto</span>}
        </div>

        {assetsProgress && (
          <div className="mt-3 p-3 bg-gray-50 rounded">
            <div className="font-medium mb-1">Verificando assets HushMic...</div>
            <div className="flex w-full bg-gray-200 rounded-full h-2.5">
              <div
                className={clsx(
                  "h-2.5 w-full bg-blue-600",
                  assetsProgress.done === assetsProgress.total && "bg-green-600"
                )}
                style={{ width: `${(assetsProgress.done / assetsProgress.total) * 100}%` }}
              ></div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {assetsProgress.done}/{assetsProgress.total} — {assetsProgress.file}
            </div>
          </div>
        )}

        <button
          onClick={async () => {
            await ensureHushmicAssets();
          }}
          className="mt-2 px-3 py-1 bg-gray-200 text-sm rounded hover:bg-gray-300"
        >
          Verificar / baixar assets HushMic
        </button>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-2">
            Selecionar perfil (criar um após gravar)
          </label>
          <select
            value={selectedProfile ?? ""}
            onChange={(e) => setSelectedProfile(e.target.value || null)}
            className="block w-full px-3 py-2 border rounded"
          >
            <option value=""> — selecionar perfil — </option>
            {profiles.map((p: Profile) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.engine})
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium mb-2">
            Texto para clonar
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="block w-full px-3 py-2 border rounded"
            placeholder="Olá, este é um teste de clonagem de voz local."
          />
        </div>

        <div className="mt-4">
          <button
            onClick={async () => {
              const gid = await generateAudio();
              if (gid) alert(`Áudio gerado! ID: ${gid}`);
            }}
            disabled={!selectedProfile || !text.trim() || loading}
            className={clsx(
              "px-4 py-2 rounded",
              !selectedProfile || !text.trim() ? "opacity-50 cursor-not-allowed" :
                loading ? "bg-gray-400" : "bg-green-600 text-white hover:bg-green-700"
            )}
          >
            {loading ? "Gerando..." : "▶ Gerar áudio"}
          </button>
          {progress && (
            <div className="mt-3 text-sm">
              {progress.stage} — {Math.round(progress.progress)}%{progress.elapsed_s ? ` (${progress.elapsed_s}s)` : ""}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
          <div className="flex items-start space-x-2">
            <XMarkIcon className="h-5 w-5 text-red-400 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
