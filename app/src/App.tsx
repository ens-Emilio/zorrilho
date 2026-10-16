import { clsx } from "clsx";
import { useSidecar } from "./lib/useSidecar";
import ClonarTab from "./components/ClonarTab";
import EstudioTab from "./components/EstudioTab";
import ProjetosTab from "./components/ProjetosTab";
import ConfiguracoesTab from "./components/ConfiguracoesTab";

const TABS = [
  { id: "clonar", label: "Clonar" },
  { id: "estudio", label: "Estúdio" },
  { id: "projetos", label: "Projetos" },
  { id: "config", label: "Configurações" },
] as const;

export default function App() {
  const { selectedTab, setSelectedTab } = useSidecar();

  return (
    <main className="min-h-screen bg-background text-foreground p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🦨 Zorrilho</h1>
        <p className="text-sm text-muted-foreground">
          Clonagem de voz local — XTTS v2 + HushMic denoising
        </p>
      </header>

      <nav className="flex space-x-1 mb-6 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSelectedTab(tab.id)}
            className={clsx(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
              selectedTab === tab.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {selectedTab === "clonar" && <ClonarTab />}
      {selectedTab === "estudio" && <EstudioTab />}
      {selectedTab === "projetos" && <ProjetosTab />}
      {selectedTab === "config" && <ConfiguracoesTab />}
    </main>
  );
}
