import { useEffect } from "react";
import { useStore } from "./lib/store";
import type { TabId } from "./lib/store";
import ClonarTab from "./components/ClonarTab";
import EstudioTab from "./components/EstudioTab";
import ProjetosTab from "./components/ProjetosTab";
import ConfiguracoesTab from "./components/ConfiguracoesTab";

const TABS: { id: TabId; label: string }[] = [
  { id: "clonar", label: "Clonar" },
  { id: "estudio", label: "Estúdio" },
  { id: "projetos", label: "Projetos" },
  { id: "config", label: "Configurações" },
];

export default function App() {
  const { activeTab, setActiveTab, refresh } = useStore();

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <main className="min-h-screen bg-white text-gray-900 p-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🦨 Zorrilho</h1>
        <p className="text-sm text-gray-500">Clonagem de voz local — XTTS v2 + HushMic denoising</p>
      </header>

      <nav className="flex space-x-1 mb-6 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "clonar" && <ClonarTab />}
      {activeTab === "estudio" && <EstudioTab />}
      {activeTab === "projetos" && <ProjetosTab />}
      {activeTab === "config" && <ConfiguracoesTab />}
    </main>
  );
}
