import { useStore } from "../lib/store";
import { exportUrl } from "../lib/sidecar";
import { invoke } from "@tauri-apps/api/core";
import { XMarkIcon } from "@heroicons/react/24/solid";

export default function ClonarTab() {
  const {
    recording, setRecording, refWav, setRefWav,
    profiles, selectedProfile, setSelectedProfile,
    text, setText, runGenerate, progress,
    loading, error, setError, newProfile,
  } = useStore();

  async function toggleRecording() {
    setError(null);
    try {
      if (!recording) {
        await invoke("record_start");
        setRecording(true);
      } else {
        const path = await invoke<string>("record_stop");
        const bytes = await invoke<Uint8Array>("read_file", { path });
        setRefWav(bytes);
        setRecording(false);
      }
    } catch (e) {
      setError(`Gravação: ${e}`);
      setRecording(false);
    }
  }

  const gid = progress?.generation_id;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Clonar voz (denoising HushMic)</h2>
        <p className="text-sm text-gray-500">
          Grave ~6s de voz limpa; o denoiser DPDFNet roda em tempo real durante a captura.
        </p>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <button
          onClick={toggleRecording}
          className={`px-4 py-2 rounded text-white ${recording ? "bg-red-600" : "bg-blue-600 hover:bg-blue-700"}`}
        >
          {recording ? "⏹ Parar gravação" : "🎤 Gravar amostra"}
        </button>

        {refWav && (
          <div className="text-sm">
            ✔ Amostra capturada ({Math.round(refWav.length / 96000)}s aprox).{" "}
            <input
              type="text"
              placeholder="Nome do perfil"
              id="profile-name"
              className="px-2 py-1 border rounded mr-2"
            />
            <button
              onClick={() => {
                const name = (document.getElementById("profile-name") as HTMLInputElement)?.value?.trim();
                if (!name) return setError("Dê um nome ao perfil.");
                newProfile(name);
              }}
              className="px-3 py-1 bg-green-600 text-white rounded"
            >
              Criar perfil
            </button>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Perfil de voz</label>
          <select
            value={selectedProfile ?? ""}
            onChange={(e) => setSelectedProfile(e.target.value || null)}
            className="block w-full px-3 py-2 border rounded"
          >
            <option value="">— selecionar —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.engine})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Texto</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="block w-full px-3 py-2 border rounded"
            placeholder="Olá, este é um teste de clonagem de voz local."
          />
        </div>

        <button
          onClick={() => runGenerate()}
          disabled={!selectedProfile || !text.trim() || loading}
          className={`px-4 py-2 rounded text-white ${(!selectedProfile || !text.trim() || loading) ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"}`}
        >
          {loading ? "Gerando..." : "▶ Gerar áudio"}
        </button>

        {progress && (
          <div className="text-sm">
            {progress.stage} — {Math.round(progress.progress)}%
            {progress.elapsed_s ? ` (${progress.elapsed_s}s)` : ""}
          </div>
        )}

        {gid && (
          <div className="space-y-2">
            <audio controls src={`${import.meta.env.VITE_SIDECAR_URL ?? "http://localhost:8765"}/api/generations/${gid}/audio`} className="w-full" />
            <div className="space-x-2">
              <a href={exportUrl(gid, "wav")} className="px-3 py-1 bg-gray-200 rounded text-sm">⬇ WAV</a>
              <a href={exportUrl(gid, "mp3")} className="px-3 py-1 bg-gray-200 rounded text-sm">⬇ MP3</a>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded flex items-start space-x-2">
          <XMarkIcon className="h-5 w-5 text-red-400 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
    </div>
  );
}
