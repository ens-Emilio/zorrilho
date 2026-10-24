import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock @tauri-apps/api/core.invoke — ClonarTab usa invoke("record_start"/"record_stop")
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "record_stop") return "/tmp/ref.wav";
    return null;
  }),
}));

// URL base para SIDECAR_URL (jsdom sem porta 5178)
Object.defineProperty(window, "location", {
  value: { ...window.location, port: "5178" },
  writable: true,
});
