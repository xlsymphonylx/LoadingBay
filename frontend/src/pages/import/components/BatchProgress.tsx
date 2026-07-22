import { CheckCircle, XCircle, Loader, Clock, Upload, Music2, FileText, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StagedFile } from "../../../hooks/useBatchSequencer";
import type { JobState } from "../../../hooks/useJobStream";
import { formatSize } from "../../../utils";
import "./BatchProgress.scss";

type Props = {
  items: StagedFile[];
  processingIndex: number;
  running: boolean;
  jobs: Map<string, JobState>;
  onCancel: () => void;
  onDone: () => void;
  onHide: () => void;
};

function PhaseIcon({ item }: { item: StagedFile }) {
  const size = 15;
  switch (item.phase) {
    case "staged":     return <Clock size={size} color="var(--text-muted)" />;
    case "uploading":  return <Upload size={size} color="var(--info)" style={{ animation: "spin 1.5s linear infinite" }} />;
    case "processing": return <Loader size={size} color="var(--info)" style={{ animation: "spin 1s linear infinite" }} />;
    case "beets":      return <Music2 size={size} color="var(--accent)" style={{ animation: "spin 2s linear infinite" }} />;
    case "lyrics":     return <FileText size={size} color="var(--accent)" style={{ animation: "spin 2s linear infinite" }} />;
    case "done":       return <CheckCircle size={size} color="var(--success)" />;
    case "failed":     return <XCircle size={size} color="var(--error)" />;
    default:           return <Clock size={size} color="var(--text-muted)" />;
  }
}

function phaseLabel(item: StagedFile, t: (key: string, opts?: object) => string): string {
  if (item.phase === "uploading" && item.uploadProgress) {
    const { sent, total } = item.uploadProgress;
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
    return t('import.uploading_pct', { pct, sent, total });
  }
  switch (item.phase) {
    case "staged":     return t('import.status.queued');
    case "uploading":  return t('import.uploading_size', { size: formatSize(item.file.size) });
    case "processing": return t('import.importing');
    case "beets":      return t('import.running_beets');
    case "lyrics":     return t('import.fetching_lyrics');
    case "done":       return t('import.status.done');
    case "failed":     return t('import.status.error');
  }
}

export default function BatchProgress({ items, processingIndex, running, jobs, onCancel, onDone, onHide }: Props) {
  const { t } = useTranslation();
  const done      = items.filter((i) => i.phase === "done").length;
  const failed    = items.filter((i) => i.phase === "failed").length;
  const uploading = items.filter((i) => i.phase === "uploading" || i.phase === "processing").length;
  const total     = items.length;
  const activeItem = processingIndex >= 0 ? items[processingIndex] : null;

  function activeBannerDetail(): string {
    if (activeItem) {
      switch (activeItem.phase) {
        case "beets":
          return t('import.beets_job', { artist: activeItem.artist ?? "", album: activeItem.album ?? "" });
        case "lyrics":
          return t('import.lyrics_job', { artist: activeItem.artist ?? "", album: activeItem.album ?? "" });
        default:
          break;
      }
    }
    if (uploading > 0) {
      const uploadingItems = items.filter((i) => i.phase === "uploading");
      if (uploadingItems.length === 1) {
        const it = uploadingItems[0];
        if (it.uploadProgress) {
          const { sent, total: t_ } = it.uploadProgress;
          const pct = t_ > 0 ? Math.round((sent / t_) * 100) : 0;
          return t('import.uploading_pct', { pct, sent, total: t_ });
        }
        return t('import.uploading_size', { size: it.file.name });
      }
      return t('import.uploading_n', { n: uploadingItems.length });
    }
    return "";
  }

  function bannerMain(): string {
    if (activeItem && (activeItem.phase === "beets" || activeItem.phase === "lyrics")) {
      const idx = items.indexOf(activeItem);
      return `Processing ${idx + 1} of ${total}…`;
    }
    if (uploading > 0) {
      const completed = done + failed;
      return uploading === 1
        ? `Uploading… (${completed}/${total} complete)`
        : `Uploading ${uploading} files… (${completed}/${total} complete)`;
    }
    return `Finishing…`;
  }

  return (
    <div className="batch-progress">
      <div className="batch-progress__banner">
        {running ? (
          <>
            <Loader size={15} color="var(--info)" className="batch-progress__spin" />
            <div className="batch-progress__banner__text">
              <span className="batch-progress__banner__main">{bannerMain()}</span>
              {activeBannerDetail() && (
                <span className="batch-progress__banner__detail">{activeBannerDetail()}</span>
              )}
            </div>
            <button className="batch-progress__cancel-btn" onClick={onCancel}>
              {t('import.cancel_after')}
            </button>
            <button className="batch-progress__done-btn" onClick={onHide}>
              Hide
            </button>
          </>
        ) : (
          <>
            {failed > 0
              ? <AlertTriangle size={15} color="var(--warning)" />
              : <CheckCircle size={15} color="var(--success)" />}
            <span className="batch-progress__banner__main">
              {done} done{failed > 0 ? `, ${failed} failed` : " — all good"}
            </span>
            <button className="batch-progress__done-btn" onClick={onDone}>
              Done
            </button>
          </>
        )}
      </div>

      <div className="batch-progress__list">
        {items.map((item, i) => {
          const job = item.jobId ? jobs.get(item.jobId) : null;
          const liveJobMsg = job && item.phase === "processing" ? job.messages[job.messages.length - 1] : null;
          const isAwaitingPrompt = job?.status === "awaiting_prompt" && item.phase === "processing";

          return (
            <div
              key={item.id}
              className={[
                "batch-progress__item",
                i === processingIndex          ? "batch-progress__item--active"  : "",
                item.phase === "uploading"     ? "batch-progress__item--active"  : "",
                item.phase === "done"          ? "batch-progress__item--done"    : "",
                item.phase === "failed"        ? "batch-progress__item--failed"  : "",
                isAwaitingPrompt               ? "batch-progress__item--waiting" : "",
              ].filter(Boolean).join(" ")}
            >
              <div className="batch-progress__item__icon">
                <PhaseIcon item={item} />
              </div>
              <div className="batch-progress__item__info">
                <span className="batch-progress__item__name">{item.file.name}</span>
                {item.artist && item.album && (
                  <span className="batch-progress__item__album">{item.artist} / {item.album}</span>
                )}
                {liveJobMsg && (
                  <span className={`batch-progress__item__live${isAwaitingPrompt ? " batch-progress__item__live--waiting" : ""}`}>
                    {isAwaitingPrompt ? "⚠ " : ""}{liveJobMsg}
                  </span>
                )}
                {item.failReason && (
                  <span className="batch-progress__item__error">{item.failReason}</span>
                )}
              </div>
              <div className="batch-progress__item__status">
                <span className="batch-progress__item__phase">{phaseLabel(item, t as (key: string, opts?: object) => string)}</span>
                {item.beetsStatus === "done"    && <span className="batch-progress__item__sub batch-progress__item__sub--done">♪ Tagged</span>}
                {item.beetsStatus === "failed"  && <span className="batch-progress__item__sub batch-progress__item__sub--fail">♪ Beets failed</span>}
                {item.lyricsStatus === "done"   && <span className="batch-progress__item__sub batch-progress__item__sub--done">📝 Lyrics</span>}
                {item.lyricsStatus === "failed" && <span className="batch-progress__item__sub batch-progress__item__sub--fail">📝 No lyrics</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
