import type { JobState } from "../../../hooks/useJobStream";
import { CheckCircle, XCircle, Loader, Clock, ChevronRight, Tag, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PromptDialog from "./PromptDialog";
import { apiFetch } from "../../../context/AuthContext";
import "./JobCard.scss";

type Props = { job: JobState; onTagWithBeets?: () => void };

const STATUS_COLOR: Record<string, string> = {
  queued: "var(--text-muted)",
  downloading: "var(--info)",
  unzipping: "var(--info)",
  parsing: "var(--info)",
  awaiting_prompt: "var(--warning)",
  copying: "var(--accent)",
  done: "var(--success)",
  error: "var(--error)",
};


function StatusIcon({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "var(--text-muted)";
  const size = 16;
  switch (status) {
    case "done":  return <CheckCircle size={size} color={color} />;
    case "error": return <XCircle size={size} color={color} />;
    case "queued": return <Clock size={size} color={color} />;
    default: return (
      <Loader
        size={size}
        color={color}
        style={{ animation: status === "awaiting_prompt" ? "none" : "spin 1s linear infinite" }}
      />
    );
  }
}

async function respond(jobId: string, answer: object) {
  await apiFetch(`/api/jobs/${jobId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });
}

export default function JobCard({ job, onTagWithBeets }: Props) {
  const { t } = useTranslation();
  const color = STATUS_COLOR[job.status] ?? "var(--text-muted)";
  const isActive = !["done", "error", "queued"].includes(job.status);
  const isDone = job.status === "done";
  const isRetryable = job.status === "error" && job.source === "discover" && !!job.album_id;

  async function retryDownload() {
    await apiFetch(`/api/discover/retry/${job.id}`, { method: "POST" });
  }

  return (
    <div className={`job-card${job.status === "awaiting_prompt" ? " job-card--awaiting" : ""}`}>
      <div className="job-card__header">
        <StatusIcon status={job.status} />
        <span className="job-card__header__filename">{job.filename}</span>
        <span className="job-card__header__status" style={{ color }}>
          {t(`import.status.${job.status}`, { defaultValue: job.status })}
        </span>
      </div>

      <div className="job-card__progress">
        {isActive && <div className="job-card__progress__bar job-card__progress__bar--active" />}
        {isDone  && <div className="job-card__progress__bar job-card__progress__bar--done" />}
      </div>

      {job.messages.length > 0 && (
        <ul className="job-card__messages">
          {job.messages.map((msg, i) => {
            const isLastError = job.status === "error" && i === job.messages.length - 1;
            const isStructureMismatch = isLastError && msg.startsWith("ZIP structure mismatch");
            if (isStructureMismatch) {
              // Render as a structured error box with line-by-line detail
              const lines = msg.split("\n");
              return (
                <li key={i} className="job-card__message job-card__message--structure-error">
                  <div className="job-card__structure-error">
                    {lines.map((line, j) =>
                      line === "" ? (
                        <br key={j} />
                      ) : (
                        <div key={j} className={
                          line.startsWith("Expected:") || line.startsWith("Found at root") || line.startsWith("ZIP structure")
                            ? "job-card__structure-error__label"
                            : line.startsWith("  •")
                              ? "job-card__structure-error__entry"
                              : "job-card__structure-error__hint"
                        }>
                          {line.trim()}
                        </div>
                      )
                    )}
                  </div>
                </li>
              );
            }
            return (
              <li key={i} className="job-card__message">
                <ChevronRight size={12} className="job-card__message__chevron" />
                {msg}
              </li>
            );
          })}
        </ul>
      )}

      {job.prompt && (
        <PromptDialog
          jobId={job.id}
          prompt={job.prompt}
          onRespond={(answer) => respond(job.id, answer)}
        />
      )}

      {isDone && job.artist && job.album && onTagWithBeets && (
        <button className="job-card__beets-btn" onClick={onTagWithBeets}>
          <Tag size={13} />
          {t('import.tag')}
        </button>
      )}

      {isRetryable && (
        <button className="job-card__beets-btn" onClick={retryDownload}>
          <RefreshCw size={13} />
          Retry download
        </button>
      )}
    </div>
  );
}
