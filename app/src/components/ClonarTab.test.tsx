import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ClonarTab from "./ClonarTab";
import { useStore } from "../lib/store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/sidecar", () => ({
  exportUrl: vi.fn(),
  preprocess: vi.fn(),
  finetuneVoice: vi.fn(),
  fetchHealth: vi.fn(),
  fetchProfiles: vi.fn(),
  fetchGenerations: vi.fn(),
  createProfile: vi.fn(),
  createProfileBatch: vi.fn(),
  deleteProfile: vi.fn(),
  generate: vi.fn(),
  watchProgress: vi.fn(),
}));

describe("ClonarTab stepper", () => {
  beforeEach(() => {
    useStore.setState({
      profiles: [],
      refWav: null,
      recording: false,
      loading: false,
      selectedEngine: "xtts_v2",
      error: null,
    });
  });

  it("passo 1 quando sem áudio — botão desabilitado e dica áudio", () => {
    render(<ClonarTab />);
    const btn = screen.getByRole("button", { name: /Criar perfil — grave ou importe primeiro/i });
    expect(btn).toBeDisabled();
    // "grave ou importe" aparece no botão e na área de import; conta que exista
    expect(screen.getAllByText(/grave ou importe/i).length).toBeGreaterThan(0);
  });

  it("passo 3 com nome válido + áudio → botão habilitado (sem rec/denoising)", () => {
    useStore.setState({ refWav: new Uint8Array([1, 2, 3]) });
    // seta nome via UI: componente usa estado local, então precisamos digitar
    const { rerender } = render(<ClonarTab />);
    // nome via input
    const input = screen.getByLabelText(/Nome do perfil/i) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, "Ana");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    rerender(<ClonarTab />);
    const btn = screen.getByRole("button", { name: /Clonar voz/i });
    expect(btn).not.toBeDisabled();
  });

  it("motor default xtts_v2 — select apresenta XTTS v2", () => {
    render(<ClonarTab />);
    const sel = screen.getByLabelText(/Motor/i) as HTMLSelectElement;
    expect(sel.value).toBe("xtts_v2");
  });
});
