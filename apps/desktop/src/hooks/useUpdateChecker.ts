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

export function useUpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const dismissedRef = useRef(false);

  const downloadAndInstall = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    try {
      setStatus("checking");
      setError(null);

      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (!update) {
        setStatus("idle");
        return;
      }

      setStatus("downloading");
      setProgress({ downloaded: 0, total: 0 });

      await update.downloadAndInstall((event) => {
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

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setStatus("idle");
    setUpdateInfo(null);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (dismissedRef.current) return;
      if (!("__TAURI_INTERNALS__" in window)) return;

      try {
        setStatus("checking");
        setError(null);

        const { check: checkUpdater } = await import("@tauri-apps/plugin-updater");
        const update = await checkUpdater();

        if (cancelled) return;

        if (update) {
          setUpdateInfo({
            version: update.version,
            date: update.date ?? undefined,
            notes: update.body ?? undefined,
          });
          setStatus("available");
        } else {
          setStatus("idle");
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("error");
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    status,
    updateInfo,
    progress,
    error,
    downloadAndInstall,
    dismiss,
  };
}
