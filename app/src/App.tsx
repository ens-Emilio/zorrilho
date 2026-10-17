import { useEffect, useState } from "react";
import ZorrilhoIcon from "./components/ZorrilhoIcon";
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
  const { activeTab, setActiveTab, refresh, health, progress } = useStore();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("zorrilho-theme") as "dark" | "light" | null;
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("zorrilho-theme", theme);
  }, [theme]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const healthOk = health.status === "ok";
  const healthLabel = healthOk ? "Online" : health.status === "loading" ? "Iniciando motor…" : "Offline";
  const dotClass = healthOk ? "status-dot" : health.status === "loading" ? "status-dot warn" : "status-dot off";
  const pct = progress ? Math.round(progress.progress) : 0;
  const showProgress = progress && progress.stage !== "done" && progress.stage !== "error";

  return (
    <div className="app-window">
      <div className="window-bar">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
        <span className="window-title">Zorrilho — {TABS.find((t) => t.id === activeTab)?.label} · localhost:8765</span>
        <span style={{ marginLeft: "auto" }} className="meta">48 kHz · WebView · v0.5.0</span>
      </div>

      <header className="header">
        <div className="brand">
          <div className="brand-mark" aria-hidden><ZorrilhoIcon size={28} /></div>
          <div className="brand-text">
            <strong>Zorrilho</strong>
            <span>XTTS + DPDFNet · offline</span>
          </div>
        </div>

        <div className="seg" role="tablist" aria-label="Abas">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="theme-toggle"
            aria-label="Alternar tema claro e escuro"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            <span className="theme-dot" />
            <b>{theme === "dark" ? "Escuro" : "Claro"}</b>
            <span style={{ opacity: 0.6 }}>↺</span>
          </button>
          <div className="status">
            <div className="status-card" id="sidecarBadge">
              <span className={dotClass} />
              <span>
                <b>{healthLabel}</b>
                {healthOk ? " · GPU · 8765" : health.status === "loading" ? " · 8765" : ""}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="progress-global">
        <i style={{ width: showProgress ? `${pct}%` : "0%" }} />
      </div>

      <div className="main-shell">
        <section className={`tab-pane ${activeTab === "clonar" ? "active" : ""}`} id="pane-clonar">
          <ClonarTab />
        </section>
        <section className={`tab-pane ${activeTab === "estudio" ? "active" : ""}`} id="pane-estudio">
          <EstudioTab />
        </section>
        <section className={`tab-pane ${activeTab === "projetos" ? "active" : ""}`} id="pane-projetos">
          <ProjetosTab />
        </section>
        <section className={`tab-pane ${activeTab === "config" ? "active" : ""}`} id="pane-config">
          <ConfiguracoesTab />
        </section>
      </div>

      <footer className="footer meta">
        <span className="num">store.ts · {progress?.stage ?? "idle"}</span>
        <span style={{ width: 1, height: 10, background: "var(--border)" }} />
        <span>select-none no shell · seleção ativa só no roteiro e logs</span>
        <span style={{ marginLeft: "auto" }} className="num">48 kHz · WAV · WebKitGTK</span>
      </footer>
    </div>
  );
}
