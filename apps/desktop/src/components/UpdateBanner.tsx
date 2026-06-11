import { Download, X } from "lucide-react";
import type { DownloadProgress, UpdateInfo, UpdateStatus } from "../hooks/useUpdateChecker";

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
            <span>更新检查失败：{error ?? "未知错误"}</span>
          ) : status === "downloading" ? (
            <span>
              正在下载 v{version}... {progressPercent}%
            </span>
          ) : status === "ready" ? (
            <span>更新已安装，正在重启...</span>
          ) : (
            <span>
              发现新版本 <strong>v{version}</strong>
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
            {status === "error" ? "重试" : "立即更新"}
          </button>
        )}
        {status !== "downloading" && status !== "ready" && (
          <button
            className="icon-button update-banner__close"
            onClick={onDismiss}
            title="忽略此次更新"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
