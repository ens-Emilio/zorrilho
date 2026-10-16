import { clsx } from "clsx";
import { useSidecar } from "../lib/useSidecar";

export default function ConfiguracoesTab() {
  const { health, ensureHushmicAssets, assetsProgress } = useSidecar();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Configurações</h2>
        <p className="text-sm text-muted-foreground">
          Verifique e baixe os assets necessários para o funcionamento.
        </p>
      </div>

      <div className="border rounded-lg p-4">
        <div className="mb-4">
          <h3 className="font-semibold">Status do sistema</h3>
          <div className="space-y-1 text-sm">
            <div>Sidecar: <span className={health.status === "ok" ? "text-green-600" : "text-red-600"}>{health.status}</span></div>
            <div>
              Banco de dados:{" "}
              <code className="bg-gray-100 px-1 rounded">{health.db.split("/").pop()}</code>
            </div>
            <div>
              Models dir:{" "}
              <code className="bg-gray-100 px-1 rounded">{health.models_dir.split("/").pop()}</code>
            </div>
            <div>
              Assets HushMic:{" "}
              <span className={health.hushmic_assets ? "text-green-600" : "text-red-600"}>
                {health.hushmic_assets ? "ok" : "ausentes"}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="font-semibold">Assets HushMic (DPDFNet)</h3>
          <p className="text-sm text-muted-foreground">
            Necessários para o denoising em tempo real durante a gravação.
          </p>
          {assetsProgress && (
            <div className="mt-4 p-3 bg-gray-50 rounded">
              <div className="font-medium mb-1">Verificando...</div>
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
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Verificar / baixar assets agora
          </button>
          <p className="text-xs text-muted-foreground mt-2">
            Após baixar, reinicie o app para garantir que o tauri veja os novos arquivos.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="font-semibold">Sobre</h3>
        <p className="text-xs text-muted-foreground">
          Zorrilho &mdash; clonagem de voz local com denoising HushMic.&nbsp;
          <a href="https://github.com/Fovty/hushmic" className="underline">HushMic</a> (DPDFNet),
          <a href="https://github.com/coqui-ai/TTS" className="underline">Coqui TTS</a> (XTTS v2).
        </p>
      </div>
    </div>
  );
}
