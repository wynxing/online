import { useCallback, useEffect, useRef, useState } from "react";

export interface UpdateInfo {
  version: string;
  date?: string;
  notes?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useUpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const dismissedRef = useRef(false);

  const checkForUpdate = useCallback(async (isCancelled?: () => boolean) => {
    if (dismissedRef.current) return null;
    if (!("__TAURI_INTERNALS__" in window)) return null;

    try {
      setStatus("checking");
      setError(null);

      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (isCancelled?.()) return null;

      if (update) {
        setUpdateInfo({
          version: update.version,
          date: update.date ?? undefined,
          notes: update.body ?? undefined,
        });
        setStatus("available");
        return update;
      }

      setUpdateInfo(null);
      setStatus("idle");
      return null;
    } catch (err: unknown) {
      if (isCancelled?.()) return null;
      setUpdateInfo(null);
      setError(toErrorMessage(err));
      setStatus("error");
      return null;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    try {
      const update = await checkForUpdate();
      if (!update) return;

      setStatus("downloading");
      setProgress({ downloaded: 0, total: 0 });

      await update.download((event) => {
        switch (event.event) {
          case "Started":
            setProgress({ downloaded: 0, total: event.data.contentLength ?? 0 });
            break;
          case "Progress":
            setProgress((prev) => ({
              downloaded: prev.downloaded + event.data.chunkLength,
              total: prev.total,
            }));
            break;
          case "Finished":
            setProgress((prev) => ({ ...prev, downloaded: prev.total }));
            break;
        }
      });

      setStatus("ready");

      let runtimeStopped = false;
      try {
        const { stopRuntime } = await import("../api");
        await stopRuntime();
        runtimeStopped = true;
      } catch (e) {
        throw Object.assign(
          new Error(`Failed to stop runtime before installing update: ${toErrorMessage(e)}`),
          { cause: e }
        );
      }

      try {
        await update.install();
      } catch (installError) {
        if (runtimeStopped) {
          try {
            const { restartRuntime } = await import("../api");
            await restartRuntime();
            runtimeStopped = false;
          } catch (restartError) {
            console.warn("restartRuntime failed after update install error:", restartError);
          }
        }
        throw installError;
      }

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err: unknown) {
      setError(toErrorMessage(err));
      setStatus("error");
    }
  }, [checkForUpdate]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setStatus("idle");
    setUpdateInfo(null);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void checkForUpdate(() => cancelled);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [checkForUpdate]);

  return {
    status,
    updateInfo,
    progress,
    error,
    downloadAndInstall,
    dismiss,
  };
}
