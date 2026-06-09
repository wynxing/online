import type { PipelineDiagnostics } from "../types";
import { formatMs } from "../utils/format";
import { StatusPill } from "./common/StatusPill";

export function DiagnosticsStrip(props: { diagnostics: PipelineDiagnostics }) {
  const diagnostics = props.diagnostics;
  return (
    <div className="diagnostics-strip">
      <StatusPill label="ASR" value={formatMs(diagnostics.latestAsrMs)} />
      <StatusPill label="翻译" value={formatMs(diagnostics.latestTranslationMs)} />
      <StatusPill label="端到端" value={formatMs(diagnostics.latestEndToEndMs)} />
      <StatusPill label="丢弃" value={String(diagnostics.droppedCount)} />
      <StatusPill label="队列" value={`${diagnostics.segmentQueueSize ?? 0}/${diagnostics.translationQueueSize ?? 0}`} />
      <StatusPill label="低能量" value={String(diagnostics.lowEnergyDrops)} />
      {diagnostics.lastDropReason && (
        <div className="diagnostics-note">最近丢弃原因：{diagnostics.lastDropReason}</div>
      )}
    </div>
  );
}
