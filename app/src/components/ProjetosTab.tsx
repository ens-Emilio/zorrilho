import { useSidecar } from "../lib/useSidecar";
import { generationAudioUrl } from "../lib/sidecar";

export default function ProjetosTab() {
  const { profiles, selectedProfile, setSelectedProfile, generations } = useSidecar();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Projetos & Histórico</h2>
        <p className="text-sm text-muted-foreground">
          Histórico de gerações por perfil de voz.
        </p>
      </div>

      <div className="border rounded-lg p-4">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Perfil</label>
          <select
            value={selectedProfile ?? ""}
            onChange={(e) => setSelectedProfile(e.target.value || null)}
            className="block w-full px-3 py-2 border rounded"
          >
            <option value=""> — selecionar — </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.engine})
              </option>
            ))}
          </select>
        </div>

        {selectedProfile && (
          <div>
            {generations.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma geração ainda.</p>
            )}
            <ul className="divide-y">
              {generations.map((g) => (
                <li key={g.id} className="py-2 space-y-1">
                  <div className="text-sm font-medium">
                    {new Date(g.created_at).toLocaleString()} · {g.engine}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {g.text}
                  </div>
                  {g.output_path && (
                    <audio
                      controls
                      src={generationAudioUrl(g.id)}
                      className="w-full"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
