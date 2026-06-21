import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { resetTauriMocks } from "./tauriMock";

vi.mock("@tauri-apps/api/core", async () => {
  const { invokeMock } = await import("./tauriMock");
  return { invoke: invokeMock };
});

vi.mock("@tauri-apps/api/event", async () => {
  const { listenMock } = await import("./tauriMock");
  return { listen: listenMock };
});

vi.mock("@tauri-apps/api/webviewWindow", async () => {
  const { WebviewWindowMock } = await import("./tauriMock");
  return { WebviewWindow: WebviewWindowMock };
});

beforeEach(() => {
  resetTauriMocks();
});
