import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjetosTab from "./ProjetosTab";
import { useStore } from "../lib/store";

vi.mock("../lib/sidecar", () => ({
  finetuneStatus: vi.fn(() => Promise.resolve(null)),
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
vi.mock("./AudioPlayer", () => ({ default: () => <div data-testid="audioplayer" /> }));

const profiles = [
  { id: "p1", name: "Ana", engine: "xtts_v2", kind: "cloned", created_at: "2026-01-01" },
  { id: "p2", name: "Bruno", engine: "f5_tts", kind: "cloned", created_at: "2026-01-03" },
  { id: "p3", name: "Ana Maria", engine: "xtts_v2", kind: "cloned", created_at: "2026-01-02" },
];

function textIs(el: Element | null, want: string): boolean {
  return el?.textContent === want;
}

describe("ProjetosTab search/ordenação", () => {
  beforeEach(() => {
    useStore.setState({ profiles: profiles as never, selectedProfile: null, generations: [] });
  });

  it("sem busca mostra todos os perfis", () => {
    render(<ProjetosTab />);
    expect(screen.getByText((_, el) => textIs(el, "3/3"))).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Bruno")).toBeInTheDocument();
  });

  it("busca filtra por nome (case-insensitive)", () => {
    render(<ProjetosTab />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar nome\/engine/i), { target: { value: "bruno" } });
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
    expect(screen.getByText((_, el) => textIs(el, "1/3"))).toBeInTheDocument();
  });

  it("busca sem resultado mostra vazio", () => {
    render(<ProjetosTab />);
    fireEvent.change(screen.getByPlaceholderText(/Buscar nome\/engine/i), { target: { value: "zzz" } });
    expect(screen.getByText(/Nenhum resultado/i)).toBeInTheDocument();
  });
});
