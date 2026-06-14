import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.relaunch,
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
    version: "0.5.0",
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
});

describe("useUpdateChecker", () => {
  it("reports an available update after the startup check", async () => {
    const update = makeUpdate({ download: vi.fn(async () => undefined) });
    mocks.check.mockResolvedValue(update);

    const { result } = renderHook(() => useUpdateChecker());

    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(result.current.updateInfo).toEqual({
      version: "0.5.0",
      date: "2026-06-10",
      notes: "test update",
    });
    expect(result.current.error).toBeNull();
  });

  it("stays idle when the startup check finds no update", async () => {
    mocks.check.mockResolvedValue(null);

    const { result } = renderHook(() => useUpdateChecker());

    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe("idle");
    expect(result.current.updateInfo).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("reports startup check errors even without update info", async () => {
    mocks.check.mockRejectedValue(new Error("manifest unavailable"));

    const { result } = renderHook(() => useUpdateChecker());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.updateInfo).toBeNull();
    expect(result.current.error).toBe("manifest unavailable");
  });

  it("retries the update check before downloading", async () => {
    const update = makeUpdate({
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
    });
    mocks.check.mockRejectedValueOnce(new Error("network failed")).mockResolvedValueOnce(update);

    const { result } = renderHook(() => useUpdateChecker());

    await waitFor(() => expect(result.current.status).toBe("error"));

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(result.current.updateInfo?.version).toBe("0.5.0");
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("downloads, installs, then relaunches in order", async () => {
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
    mocks.relaunch.mockImplementation(async () => {
      order.push("relaunch");
    });

    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(order).toEqual(["download", "install", "relaunch"]);
    expect(result.current.progress).toEqual({ downloaded: 100, total: 100 });
    expect(result.current.status).toBe("ready");
  });

  it("does not install when downloading fails", async () => {
    const update = makeUpdate({
      download: vi.fn(async () => {
        throw new Error("download failed");
      }),
    });
    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(update.install).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("download failed");
  });

  it("does not relaunch when installing fails", async () => {
    const update = makeUpdate({
      install: vi.fn(async () => {
        throw new Error("install failed");
      }),
    });
    const { result } = await renderAvailableHook(update);

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(mocks.relaunch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("install failed");
  });
});
