import { useState, useRef } from "react";
import {
  X, HelpCircle, FolderPlus, AlertTriangle,
  ListMusic, FilePlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../context/AuthContext";
import type { JobState, Prompt } from "../hooks/useJobStream";

export function jobLabel(job: JobState): string {
  return job.artist && job.album ? `${job.artist} — ${job.album}` : job.filename;
}

// ── Modal wrapper ──────────────────────────────────────────────────────────────

export function PromptModal({
  job,
  onRespond,
  onClose,
}: {
  job: JobState;
  onRespond: (answer: object) => Promise<void>;
  onClose: () => void;
}) {
  const prompt = job.prompt!;

  return (
    <div className="fc-modal__backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fc-modal">
        <div className="fc-modal__header">
          <PromptIcon prompt={prompt} />
          <span className="fc-modal__title">{jobLabel(job)}</span>
          <button className="fc-modal__close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="fc-modal__body">
          <PromptBody prompt={prompt} jobId={job.id} onRespond={onRespond} />
        </div>
      </div>
    </div>
  );
}

function PromptIcon({ prompt }: { prompt: Prompt }) {
  const color = "var(--warning)";
  switch (prompt.kind) {
    case "album_exists":    return <AlertTriangle size={16} color="var(--error)" />;
    case "artist_missing":  return <FolderPlus size={16} color={color} />;
    case "review_tracks":   return <ListMusic size={16} color={color} />;
    default:                return <HelpCircle size={16} color={color} />;
  }
}

// ── Prompt body variants ───────────────────────────────────────────────────────

function PromptBody({
  prompt,
  jobId,
  onRespond,
}: {
  prompt: Prompt;
  jobId: string;
  onRespond: (answer: object) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [artistName, setArtistName] = useState(prompt.kind === "artist_missing" ? prompt.artist : "");

  async function answer(payload: object) {
    if (submitting) return;
    setSubmitting(true);
    await onRespond(payload);
  }

  if (prompt.kind === "separator_choice") {
    return (
      <>
        <p className="fc-modal__prompt-body">{t("prompt.separator_body")}</p>
        <div className="fc-modal__prompt-options">
          {prompt.options.map((opt, i) => (
            <button
              key={i}
              className="fc-modal__prompt-option"
              disabled={submitting}
              onClick={() => answer({ kind: "separator_choice", index: i })}
            >
              <strong>{opt.label}</strong>
              <span>→ <em>{opt.artist}</em> / <em>{opt.album}</em></span>
            </button>
          ))}
        </div>
      </>
    );
  }

  if (prompt.kind === "artist_missing") {
    return (
      <>
        <p className="fc-modal__prompt-body">{t("prompt.artist_missing_body", { artist: prompt.artist })}</p>
        <input
          className="fc-modal__name-input"
          value={artistName}
          onChange={e => setArtistName(e.target.value)}
          placeholder={t("prompt.artist_name_placeholder")}
          spellCheck={false}
        />
        <div className="fc-modal__actions">
          <button className="fc-modal__proceed" disabled={submitting || !artistName.trim()}
            onClick={() => answer({ kind: "artist_missing", create: true, name: artistName.trim() })}>
            {t("prompt.create_folder")}
          </button>
          <button className="fc-modal__cancel" disabled={submitting}
            onClick={() => answer({ kind: "artist_missing", create: false })}>
            {t("prompt.skip_file")}
          </button>
        </div>
      </>
    );
  }

  if (prompt.kind === "album_exists") {
    return (
      <>
        <p className="fc-modal__prompt-body">
          {t("prompt.album_exists_body", { artist: prompt.artist, album: prompt.album })}
        </p>
        <div className="fc-modal__actions">
          <button className="fc-modal__cancel" disabled={submitting}
            onClick={() => answer({ kind: "album_exists", overwrite: true })}>
            {t("prompt.overwrite")}
          </button>
          <button className="fc-modal__proceed" disabled={submitting}
            onClick={() => answer({ kind: "album_exists", overwrite: false })}>
            {t("prompt.skip")}
          </button>
        </div>
      </>
    );
  }

  if (prompt.kind === "review_tracks") {
    return (
      <ReviewTracksBody
        jobId={jobId}
        tracks={prompt.tracks}
        stagedTracks={prompt.staged_tracks}
        onAnswer={answer}
        submitting={submitting}
      />
    );
  }

  return null;
}

function ReviewTracksBody({
  jobId,
  tracks,
  stagedTracks,
  onAnswer,
  submitting,
}: {
  jobId: string;
  tracks: string[];
  stagedTracks: string[];
  onAnswer: (payload: object) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const allTracks = [...tracks, ...stagedTracks];

  async function uploadSupplemental(files: FileList) {
    setUploading(true);
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f, f.name));
    try {
      await apiFetch(`/api/jobs/${jobId}/files`, { method: "POST", body: form });
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <p className="fc-modal__count">{t("filecheck.count", { count: allTracks.length })}</p>
      <div className="fc-modal__tracklist">
        {tracks.map((tr, i) => (
          <div key={i} className="fc-modal__track">{tr}</div>
        ))}
        {stagedTracks.map((tr, i) => (
          <div key={`s${i}`} className="fc-modal__track fc-modal__track--staged">+ {tr}</div>
        ))}
        {allTracks.length === 0 && (
          <div className="fc-modal__track fc-modal__track--empty">{t("filecheck.no_tracks")}</div>
        )}
      </div>
      <div className="fc-modal__actions">
        <button className="fc-modal__add-btn" disabled={uploading || submitting}
          onClick={() => fileRef.current?.click()}>
          <FilePlus size={13} />
          {uploading ? t("filecheck.uploading") : t("filecheck.add_files")}
        </button>
        <button className="fc-modal__proceed" disabled={submitting}
          onClick={() => onAnswer({ kind: "review_tracks", proceed: true })}>
          {t("filecheck.looks_good")}
        </button>
        <button className="fc-modal__cancel" disabled={submitting}
          onClick={() => onAnswer({ kind: "review_tracks", proceed: false })}>
          {t("filecheck.cancel")}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.ape,.wv,.aiff,.aif"
        multiple
        style={{ display: "none" }}
        onChange={(e) => e.target.files && uploadSupplemental(e.target.files)}
      />
    </>
  );
}
