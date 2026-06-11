import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  restartRuntime: vi.fn(),
  stopRuntime: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
}));

vi.mock("../../api", () => ({
  restartRuntime: mocks.restartRuntime,
  stopRuntime: mocks.stopRuntime,
}));

type DownloadHandler = (event: {
  event: "Started" | "Progress" | "Finished";
  data?: { contentLength?: number; chunkLength?: number };
}) => void;

function makeUpdate(
  overrides: Partial<{
    download: (handler: DownloadHandler) => Promise<void>;
    install: () => Promise<void>;
  }> = {}
) {
  return {
    version: "0.4.11",
    date: "2026-06-10",
    body: "test update",
    download:
      overrides.download ??
      vi.fn(async (handler: DownloadHandler) => {
        handler({ event: "Started", data: { contentLength: 100 } });
        handler({ event: "Progress", data: { chunkLength: 100 } });
        handler({ event: "Finished" });
      }),
    install: overrides.install ?? vi.fn(async () => undefined),
  };
}

async function renderAvailableHook(update: ReturnType<typeof makeUpdate>) {
  mocks.check.mockResolvedValue(update);
  const hook = renderHook(() => useUpdateChecker());
  await waitFor(() => expect(hook.result.current.status).toBe("available"));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.restartRuntime.mockResolvedValue(undefined);
  mocks.stopRuntime.mockResolvedValue(undefined);
});

describe("useUpdateChecker", () => {
  it("downloads, stops runtime, installs, then relaunches in order", async () => {
    const order: string[] = [];
    const update = makeUpdate({
      download: vi.fn(async (handler: DownloadHandler) => {
        order.push("download");
        handler({ event: "Started", data: { contentLength: 100 } });
        handler({ event: "Progress", data: { chunkLength: 100 } });
        handler({ event: "Finished" });
      }),
      install: vi.fn(async () => {
        order.push("install");
      }),
    });
    mocks.stopRuntime.mockImplementation(async () => {
      order.push("stopRuntime");
    });
    mocks.relaunch.mockImplementation(async () => {
      order.push("relaunch");
    });

    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(order).toEqual(["download", "stopRuntime", "install", "relaunch"]);
    expect(result.current.progress).toEqual({ downloaded: 100, total: 100 });
    expect(result.current.status).toBe("ready");
  });

  it("does not stop runtime when downloading fails", async () => {
    const update = makeUpdate({
      download: vi.fn(async () => {
        throw new Error("download failed");
      }),
    });
    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mocks.stopRuntime).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("download failed");
  });

  it("does not install when stopping runtime fails", async () => {
    const update = makeUpdate();
    mocks.stopRuntime.mockRejectedValue(new Error("stop failed"));
    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mocks.stopRuntime).toHaveBeenCalledTimes(1);
    expect(update.install).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(
      "Failed to stop runtime before installing update: stop failed"
    );
  });

  it("restarts runtime when installing fails after runtime was stopped", async () => {
    const order: string[] = [];
    const update = makeUpdate({
      download: vi.fn(async () => {
        order.push("download");
      }),
      install: vi.fn(async () => {
        order.push("install");
        throw new Error("install failed");
      }),
    });
    mocks.stopRuntime.mockImplementation(async () => {
      order.push("stopRuntime");
    });
    mocks.restartRuntime.mockImplementation(async () => {
      order.push("restartRuntime");
    });
    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(order).toEqual(["download", "stopRuntime", "install", "restartRuntime"]);
    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("install failed");
  });
});
