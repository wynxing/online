import { Download, X } from "lucide-react";
import type { DownloadProgress, UpdateInfo, UpdateStatus } from "../hooks/useUpdateChecker";
import { t, useLang } from "../i18n";

interface UpdateBannerProps {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: DownloadProgress;
  error: string | null;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  status,
  updateInfo,
  progress,
  error,
  onUpdate,
  onDismiss,
}: UpdateBannerProps) {
  const lang = useLang();
  if (status === "idle" || status === "checking") {
    return null;
  }

  if (status !== "error" && !updateInfo) {
    return null;
  }

  const progressPercent =
    progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;
  const version = updateInfo?.version ?? "";

  return (
    <div className={`update-banner ${status === "error" ? "update-banner--error" : ""}`}>
      <div className="update-banner__content">
        <Download size={16} />
        <div className="update-banner__info">
          {status === "error" ? (
            <span>
              {t("update.checkFailed", lang)}：{error ?? t("errorBoundary.unknownError", lang)}
            </span>
          ) : status === "downloading" ? (
            <span>
              {t("update.downloading", lang)} v{version}... {progressPercent}%
            </span>
          ) : status === "ready" ? (
            <span>{t("update.installedRestarting", lang)}</span>
          ) : (
            <span>
              {t("update.newVersion", lang)} <strong>v{version}</strong>
              {updateInfo?.notes && ` - ${updateInfo.notes}`}
            </span>
          )}
        </div>
      </div>

      {status === "downloading" && progress.total > 0 && (
        <div className="update-banner__progress">
          <div className="update-banner__progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>
      )}

      <div className="update-banner__actions">
        {(status === "available" || status === "error") && (
          <button className="primary-button update-banner__btn" onClick={onUpdate}>
            {status === "error" ? t("update.retry", lang) : t("update.updateNow", lang)}
          </button>
        )}
        {status !== "downloading" && status !== "ready" && (
          <button
            className="icon-button update-banner__close"
            onClick={onDismiss}
            title={t("update.dismissTooltip", lang)}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
