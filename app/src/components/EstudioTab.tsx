import { useSidecar } from "../lib/useSidecar";
import type { Profile } from "../lib/sidecar";
import { Textarea } from "@headlessui/react";

export default function EstudioTab() {
  const { text, setText, profiles, selectedProfile, setSelectedProfile, generateAudio } =
    useSidecar();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Estúdio de voz</h2>
        <p className="text-sm text-muted-foreground">
          Texto livre para síntese com os perfis criados. Útil para testes rápidos.
        </p>
      </div>

      <div className="border rounded-lg p-4">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            Selecionar perfil
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

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            Texto para síntese
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="block w-full px-3 py-2 border rounded"
            placeholder="Digite aqui o que você quer ouvir..."
          />
        </div>

        <div className="mb-4">
          <button
            onClick={async () => {
              if (!selectedProfile) return alert("Selecione um perfil primeiro");
              if (!text.trim()) return alert("Digite algum texto");
              const gid = await generateAudio();
              if (gid) {
                alert(`Áudio gerado! ID: ${gid}`);
              }
            }}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            ▶ Sintetizar texto
          </button>
        </div>
      </div>
    </div>
  );
}
