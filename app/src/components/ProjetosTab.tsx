import { useEffect } from "react";
import { useStore } from "../lib/store";
import { generationAudioUrl, exportUrl } from "../lib/sidecar";

export default function ProjetosTab() {
  const { profiles, selectedProfile, setSelectedProfile, generations, refreshGenerations, removeProfile } = useStore();

  useEffect(() => {
    refreshGenerations();
  }, [selectedProfile, refreshGenerations]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Projetos & Histórico</h2>
        <p className="text-sm text-gray-500">Gerações por perfil de voz.</p>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex space-x-2">
          <select
            value={selectedProfile ?? ""}
            onChange={(e) => setSelectedProfile(e.target.value || null)}
            className="flex-1 px-3 py-2 border rounded"
          >
            <option value="">— selecionar perfil —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selectedProfile && (
            <button
              onClick={() => { if (confirm("Excluir este perfil e suas referências?")) removeProfile(); }}
              className="px-3 py-2 bg-red-100 text-red-700 rounded text-sm"
            >
              Excluir perfil
            </button>
          )}
        </div>

        {selectedProfile && generations.length === 0 && (
          <p className="text-sm text-gray-500">Nenhuma geração ainda para este perfil.</p>
        )}

        <ul className="divide-y">
          {generations.map((g) => (
            <li key={g.id} className="py-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {new Date(g.created_at).toLocaleString()}
                </span>
                <span className="text-gray-500">
                  {g.engine} · {Math.round(g.duration_ms / 100) / 10}s
                </span>
              </div>
              <div className="text-xs text-gray-500 line-clamp-1">{g.text}</div>
              <audio controls src={generationAudioUrl(g.id)} className="w-full" />
              <div className="space-x-2">
                <a href={exportUrl(g.id, "wav")} className="px-2 py-1 bg-gray-200 rounded text-xs">⬇ WAV</a>
                <a href={exportUrl(g.id, "mp3")} className="px-2 py-1 bg-gray-200 rounded text-xs">⬇ MP3</a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
