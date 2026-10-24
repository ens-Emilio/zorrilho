import { describe, expect, it, vi, beforeEach } from "vitest";
import { useStore } from "./store";
import * as sidecar from "./sidecar";

vi.mock("./sidecar", () => ({
  fetchHealth: vi.fn(),
  fetchProfiles: vi.fn(),
  fetchGenerations: vi.fn(),
  createProfile: vi.fn(),
  createProfileBatch: vi.fn(),
  deleteProfile: vi.fn(),
  ensureAssets: vi.fn(),
  watchProgress: vi.fn(),
  generate: vi.fn(),
}));

// tipo do callback de watchProgress no sidecar real
type ProgressCb = Parameters<typeof sidecar.watchProgress>[1];

// deferred min. sem Promise.withResolvers (lib ES2023 no tsconfig)
function makeGate() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("store: runGenerate guardas", () => {
  beforeEach(() => useStore.setState({ selectedProfile: null, text: "", loading: false, error: null }));

  it("não gera sem perfil selecionado → seta error", async () => {
    useStore.setState({ text: "base ola mundo teste" });
    const r = await useStore.getState().runGenerate();
    expect(r).toBeNull();
    expect(useStore.getState().error).toMatch(/Selecione um perfil/);
    expect(useStore.getState().loading).toBe(false);
    expect(sidecar.generate).not.toHaveBeenCalled();
  });

  it("não gera sem texto → seta error", async () => {
    useStore.setState({ selectedProfile: "p1", text: "   " });
    const r = await useStore.getState().runGenerate();
    expect(r).toBeNull();
    expect(useStore.getState().error).toMatch(/Selecione um perfil e digite/);
    expect(sidecar.generate).not.toHaveBeenCalled();
  });

  it("passa engineOverride/language ao sidecar e marca loading durante WS", async () => {
    const task = makeGate();
    let evtCb: ProgressCb | undefined;
    vi.mocked(sidecar.generate).mockReturnValueOnce(task.promise);
    vi.mocked(sidecar.watchProgress).mockImplementation((_id, cb) => {
      evtCb = cb;
      return () => {};
    });
    useStore.setState({ selectedProfile: "p1", text: "texto de geracao" });
    const p = useStore.getState().runGenerate({ engineOverride: "f5_tts", language: "en" });
    expect(useStore.getState().loading).toBe(true);
    expect(sidecar.generate).toHaveBeenCalledWith("texto de geracao", "p1", "en", "f5_tts");
    task.resolve("task1");
    await Promise.resolve();
    await Promise.resolve();
    expect(evtCb).toBeDefined();
    evtCb!({ stage: "done", generation_id: "g1", progress: 100 });
    const gid = await p;
    expect(gid).toBe("g1");
    expect(useStore.getState().loading).toBe(false);
  });

  it("transmite erro do WS → retorna null e seta error", async () => {
    const task = makeGate();
    let evtCb: ProgressCb | undefined;
    vi.mocked(sidecar.generate).mockReturnValueOnce(task.promise);
    vi.mocked(sidecar.watchProgress).mockImplementation((_id, cb) => {
      evtCb = cb;
      return () => {};
    });
    useStore.setState({ selectedProfile: "p1", text: "algum texto" });
    const p = useStore.getState().runGenerate();
    task.resolve("task1");
    await Promise.resolve();
    await Promise.resolve();
    expect(evtCb).toBeDefined();
    evtCb!({ stage: "error", error: "falha de sintese", progress: 0 });
    const r = await p;
    expect(r).toBeNull();
    expect(useStore.getState().error).toContain("falha de sintese");
    expect(useStore.getState().loading).toBe(false);
  });
});
