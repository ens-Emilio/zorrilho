import { useStore } from "../lib/store";

export default function ConfiguracoesTab() {
  const { health, downloadAssets, assetsProgress, refresh, error } = useStore();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Configurações</h2>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="font-semibold mb-2">Status do sistema</h3>
          <div className="space-y-1 text-sm">
            <div>Sidecar: <span className={health.status === "ok" ? "text-green-600" : "text-red-600"}>{health.status}</span></div>
            <div>Banco: <code className="bg-gray-100 px-1 rounded">{health.db.split("/").pop()}</code></div>
            <div>Assets HushMic: <span className={health.hushmic_assets ? "text-green-600" : "text-red-600"}>{health.hushmic_assets ? "ok" : "ausentes"}</span></div>
          </div>
          <button onClick={refresh} className="mt-2 px-3 py-1 bg-gray-200 rounded text-sm">↻ Recarregar</button>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Assets HushMic (DPDFNet)</h3>
          {assetsProgress && (
            <div className="mb-2">
              <div className="flex w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 ${assetsProgress.done === assetsProgress.total ? "bg-green-600" : "bg-blue-600"}`}
                  style={{ width: `${(assetsProgress.done / assetsProgress.total) * 100}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">{assetsProgress.done}/{assetsProgress.total} — {assetsProgress.file}</div>
            </div>
          )}
          <button onClick={downloadAssets} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">
            Verificar / baixar assets
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="text-xs text-gray-500">
        Zorrilho — clonagem de voz local. Denoising:{" "}
        <a href="https://github.com/Fovty/hushmic" className="underline" target="_blank">HushMic</a> (DPDFNet, Apache-2.0). TTS:{" "}
        <a href="https://coqui.ai/cpml" className="underline" target="_blank">XTTS v2</a> (CPML, uso não-comercial).
      </div>
    </div>
  );
}
