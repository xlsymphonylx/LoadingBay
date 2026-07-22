import { useState, useEffect } from "react";
import {
  X, CheckCircle2, AlertCircle, MessageSquare, Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useJobStream } from "../hooks/useJobStream";
import { apiFetch } from "../context/AuthContext";
import type { JobState, Prompt } from "../hooks/useJobStream";
import { PromptModal, jobLabel } from "./FilecheckPromptModal";
import "./FilecheckToast.scss";

// ── Types ──────────────────────────────────────────────────────────────────────

type PromptReviewState = "pending" | "modal" | "dismissed";

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function promptToastLabel(prompt: Prompt, t: (k: string, opts?: any) => string): string {
  switch (prompt.kind) {
    case "artist_missing":  return t("prompt.artist_missing_title");
    case "album_exists":    return t("prompt.album_exists_title");
    case "separator_choice": return t("prompt.separator_title");
    case "review_tracks":   return t("filecheck.toast_sub", { count: prompt.tracks.length });
    default:                return t("prompt.action_needed");
  }
}

const ACTIVE_STATUSES = new Set(["queued", "downloading", "unzipping", "parsing", "copying"]);
const DISMISSED_KEY = "loadingbay.dismissedJobToasts";
const PROMPT_DISMISSED_KEY = "loadingbay.dismissedPromptToasts";

function readStoredSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeStoredSet(key: string, values: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...values].slice(-300)));
}

async function respond(jobId: string, answer: object) {
  await apiFetch(`/api/jobs/${jobId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer),
  });
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function FilecheckToast() {
  const { t } = useTranslation();
  const { jobs } = useJobStream();

  // Track which job ids we've ever seen (so toasts don't vanish until dismissed)
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
  // Which done/error jobs have been dismissed by the user or auto-timer
  const [dismissed, setDismissed] = useState<Set<string>>(() => readStoredSet(DISMISSED_KEY));
  // Prompt review state per job
  const [promptStates, setPromptStates] = useState<Record<string, PromptReviewState>>(() => {
    const stored = readStoredSet(PROMPT_DISMISSED_KEY);
    return Object.fromEntries([...stored].map((id) => [id, "dismissed" as PromptReviewState]));
  });
  const [activeModal, setActiveModal] = useState<JobState | null>(null);

  // Register new jobs as they appear
  useEffect(() => {
    setTrackedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const job of jobs.values()) {
        if (!next.has(job.id)) { next.add(job.id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [jobs]);

  // Auto-dismiss done/cancelled toasts after 5 s; errors persist
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of trackedIds) {
      const job = jobs.get(id);
      if ((job?.status === "done" || job?.status === "cancelled") && !dismissed.has(id)) {
        const t = setTimeout(() => {
          dismiss(id);
        }, job.status === "cancelled" ? 4000 : 8000);
        timers.push(t);
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [trackedIds, jobs, dismissed]);

  // Close modal when its job leaves awaiting_prompt
  useEffect(() => {
    if (activeModal) {
      const current = jobs.get(activeModal.id);
      if (!current || current.status !== "awaiting_prompt") setActiveModal(null);
    }
  }, [jobs, activeModal]);

  function dismiss(id: string) {
    setDismissed((p) => {
      const next = new Set([...p, id]);
      writeStoredSet(DISMISSED_KEY, next);
      return next;
    });
  }
  function getPromptState(id: string): PromptReviewState { return promptStates[id] ?? "pending"; }
  function setPromptState(id: string, s: PromptReviewState) {
    if (s === "dismissed") {
      const stored = readStoredSet(PROMPT_DISMISSED_KEY);
      stored.add(id);
      writeStoredSet(PROMPT_DISMISSED_KEY, stored);
    }
    setPromptStates((p) => ({ ...p, [id]: s }));
  }

  // Build ordered list of visible toasts (newest job first within each group)
  const visible: JobState[] = [];
  for (const id of trackedIds) {
    if (dismissed.has(id)) continue;
    const job = jobs.get(id);
    if (!job) continue;
    // Prompt toasts: hide if explicitly dismissed by user
    if (job.status === "awaiting_prompt" && getPromptState(id) === "dismissed") continue;
    visible.push(job);
  }
  // Sort: active first, then prompts, then completions — newest id last
  const order = (j: JobState) =>
    ACTIVE_STATUSES.has(j.status) ? 0 : j.status === "awaiting_prompt" ? 1 : 2;
  visible.sort((a, b) => order(a) - order(b));

  if (visible.length === 0 && !activeModal) return null;

  return (
    <>
      <div className="fc-toasts">
        {visible.map((job) => {
          if (ACTIVE_STATUSES.has(job.status)) {
            return (
              <div key={job.id} className="fc-toast fc-toast--active">
                <Loader2 size={15} className="fc-toast__spinner" />
                <div className="fc-toast__body">
                  <span className="fc-toast__title">{jobLabel(job)}</span>
                  <span className="fc-toast__sub">{t(`status.${job.status}`, job.status)}</span>
                </div>
              </div>
            );
          }

          if (job.status === "awaiting_prompt" && job.prompt != null) {
            return (
              <div key={job.id} className="fc-toast fc-toast--prompt">
                <MessageSquare size={15} className="fc-toast__icon" />
                <div className="fc-toast__body">
                  <span className="fc-toast__title">{jobLabel(job)}</span>
                  <span className="fc-toast__sub">{promptToastLabel(job.prompt, t)}</span>
                </div>
                <button
                  className="fc-toast__check"
                  onClick={() => { setActiveModal(job); setPromptState(job.id, "modal"); }}
                >
                  {t("filecheck.check")}
                </button>
                <button
                  className="fc-toast__dismiss"
                  title={t("filecheck.dismiss")}
                  onClick={() => setPromptState(job.id, "dismissed")}
                >
                  <X size={12} />
                </button>
              </div>
            );
          }

          if (job.status === "done" || job.status === "cancelled" || job.status === "error") {
            const isDone = job.status === "done";
            const isCancelled = job.status === "cancelled";
            return (
              <div key={job.id} className={`fc-toast${isDone ? "" : isCancelled ? " fc-toast--cancelled" : " fc-toast--error"}`}>
                <div className="fc-toast__icon">
                  {isDone ? <CheckCircle2 size={16} /> : isCancelled ? <X size={16} /> : <AlertCircle size={16} />}
                </div>
                <div className="fc-toast__body">
                  <span className="fc-toast__title">
                    {isDone ? t("download.toast_done") : isCancelled ? t("download.toast_cancelled") : t("download.toast_error")}
                  </span>
                  <span className="fc-toast__sub">{jobLabel(job)}</span>
                </div>
                <button className="fc-toast__dismiss" onClick={() => dismiss(job.id)} title={t("filecheck.dismiss")}>
                  <X size={12} />
                </button>
              </div>
            );
          }

          return null;
        })}
      </div>

      {activeModal && activeModal.prompt && (
        <PromptModal
          job={activeModal}
          onRespond={async (answer) => {
            await respond(activeModal.id, answer);
            setActiveModal(null);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}
    </>
  );
}
