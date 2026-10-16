import { useStore } from "../lib/store";
import { exportUrl } from "../lib/sidecar";
import { XMarkIcon } from "@heroicons/react/24/solid";

export default function EstudioTab() {
  const {
    profiles, selectedProfile, setSelectedProfile,
    text, setText, runGenerate, progress, loading, error,
  } = useStore();

  const chars = text.length;
  const estimatedSec = Math.round((chars / 14) * 10) / 10; // ~14 chars/s fala pt
  const gid = progress?.generation_id;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Estúdio</h2>
        <p className="text-sm text-gray-500">Editor de roteiro — síntese longa com o perfil selecionado.</p>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Perfil</label>
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
          <div className="flex justify-between mb-1">
            <label className="text-sm font-medium">Roteiro</label>
            <span className="text-xs text-gray-500">
              {chars} chars · ~{estimatedSec}s de áudio
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="block w-full px-3 py-2 border rounded font-mono text-sm"
            placeholder="Cole ou digite o roteiro completo aqui..."
          />
        </div>

        <button
          onClick={() => runGenerate()}
          disabled={!selectedProfile || !text.trim() || loading}
          className={`px-4 py-2 rounded text-white ${(!selectedProfile || !text.trim() || loading) ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"}`}
        >
          {loading ? "Sintetizando..." : "▶ Sintetizar roteiro"}
        </button>

        {progress && (
          <div className="text-sm">{progress.stage} — {Math.round(progress.progress)}%</div>
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
