import type { PipelineDiagnostics } from "../types";
import { formatMs } from "../utils/format";
import { StatusPill } from "./common/StatusPill";
import { t, useLang } from "../i18n";

export function DiagnosticsStrip(props: { diagnostics: PipelineDiagnostics }) {
  const lang = useLang();
  const diagnostics = props.diagnostics;
  return (
    <div className="diagnostics-strip">
      <StatusPill label={t("diagnostics.asr", lang)} value={formatMs(diagnostics.latestAsrMs)} />
      <StatusPill
        label={t("diagnostics.translation", lang)}
        value={formatMs(diagnostics.latestTranslationMs)}
      />
      <StatusPill
        label={t("diagnostics.endToEnd", lang)}
        value={formatMs(diagnostics.latestEndToEndMs)}
      />
      <StatusPill label={t("diagnostics.dropped", lang)} value={String(diagnostics.droppedCount)} />
      <StatusPill
        label={t("diagnostics.queue", lang)}
        value={`${diagnostics.segmentQueueSize ?? 0}/${diagnostics.translationQueueSize ?? 0}`}
      />
      <StatusPill
        label={t("diagnostics.lowEnergy", lang)}
        value={String(diagnostics.lowEnergyDrops)}
      />
      {diagnostics.lastDropReason && (
        <div className="diagnostics-note">
          {t("diagnostics.lastDropReason", lang)}: {diagnostics.lastDropReason}
        </div>
      )}
    </div>
  );
}
