import { useState, useRef } from "react";
import type { Prompt } from "../../../hooks/useJobStream";
import { HelpCircle, FolderPlus, ListMusic, FilePlus, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../../context/AuthContext";
import "./PromptDialog.scss";

type Props = { jobId: string; prompt: Prompt; onRespond: (answer: object) => void };

export default function PromptDialog({ jobId: _jobId, prompt, onRespond }: Props) {
  const { t } = useTranslation();
  const [answered, setAnswered] = useState(false);
  const [artistName, setArtistName] = useState(prompt.kind === "artist_missing" ? prompt.artist : "");

  function answer(payload: object) {
    if (answered) return;
    setAnswered(true);
    onRespond(payload);
  }

  if (answered) {
    return <div className="prompt__box prompt__box--answered">{t('prompt.answered')}</div>;
  }

  if (prompt.kind === "separator_choice") {
    return (
      <div className="prompt__box">
        <div className="prompt__header">
          <HelpCircle size={15} color="var(--warning)" />
          <span className="prompt__header__title">{t('prompt.separator_title')}</span>
        </div>
        <p className="prompt__body">
          {t('prompt.separator_body')}
        </p>
        <div className="prompt__actions">
          {prompt.options.map((opt, i) => (
            <button
              key={i}
              className="prompt__separator-option"
              onClick={() => answer({ kind: "separator_choice", index: i })}
            >
              <span className="prompt__separator-option__label">{opt.label}</span>
              <span className="prompt__separator-option__sep">{t('prompt.separator_album')}</span>
              <strong>{opt.album}</strong>
              <span className="prompt__separator-option__sep" style={{ margin: "0 6px" }}>{t('prompt.separator_artist')}</span>
              <strong>{opt.artist}</strong>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (prompt.kind === "artist_missing") {
    return (
      <div className="prompt__box">
        <div className="prompt__header">
          <FolderPlus size={15} color="var(--warning)" />
          <span className="prompt__header__title">{t('prompt.artist_missing_title')}</span>
        </div>
        <p className="prompt__body">
          {t('prompt.artist_missing_body', { artist: prompt.artist })}
        </p>
        <input
          className="prompt__name-input"
          value={artistName}
          onChange={e => setArtistName(e.target.value)}
          placeholder={t('prompt.artist_name_placeholder')}
          spellCheck={false}
        />
        <div className="prompt__actions">
          <button className="prompt__btn--primary" disabled={!artistName.trim()} onClick={() => answer({ kind: "artist_missing", create: true, name: artistName.trim() })}>
            {t('prompt.create_folder')}
          </button>
          <button className="prompt__btn--danger" onClick={() => answer({ kind: "artist_missing", create: false })}>
            {t('prompt.skip_file')}
          </button>
        </div>
      </div>
    );
  }

  if (prompt.kind === "album_exists") {
    return (
      <div className="prompt__box">
        <div className="prompt__header">
          <AlertTriangle size={15} color="var(--error)" />
          <span className="prompt__header__title">{t('prompt.album_exists_title')}</span>
        </div>
        <p className="prompt__body">
          {t('prompt.album_exists_body', { artist: prompt.artist, album: prompt.album })}
        </p>
        <div className="prompt__actions">
          <button className="prompt__btn--danger" onClick={() => answer({ kind: "album_exists", overwrite: true })}>
            {t('prompt.overwrite')}
          </button>
          <button className="prompt__btn--ghost" onClick={() => answer({ kind: "album_exists", overwrite: false })}>
            {t('prompt.skip')}
          </button>
        </div>
      </div>
    );
  }

  if (prompt.kind === "review_tracks") {
    return (
      <ReviewTracksDialog
        jobId={_jobId}
        tracks={prompt.tracks}
        stagedTracks={prompt.staged_tracks}
        onAnswer={answer}
      />
    );
  }

  return null;
}

type ReviewProps = {
  jobId: string;
  tracks: string[];
  stagedTracks: string[];
  onAnswer: (payload: object) => void;
};

function ReviewTracksDialog({ jobId, tracks, stagedTracks, onAnswer }: ReviewProps) {
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
    <div className="prompt__box">
      <div className="prompt__header">
        <ListMusic size={15} color="var(--warning)" />
        <span className="prompt__header__title">
          {t('prompt.review_title', { count: allTracks.length })}
        </span>
      </div>

      <div className="prompt__track-list">
        {tracks.map((t, i) => (
          <div key={i} className="prompt__track-list__item">{t}</div>
        ))}
        {stagedTracks.map((t, i) => (
          <div key={`s${i}`} className="prompt__track-list__item prompt__track-list__item--staged">
            + {t}
          </div>
        ))}
        {allTracks.length === 0 && (
          <div className="prompt__track-list__item prompt__track-list__item--empty">{t('prompt.no_tracks')}</div>
        )}
      </div>

      <div className="prompt__actions">
        <button
          className="prompt__add-files-btn"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <FilePlus size={13} />
          {uploading ? t('prompt.uploading') : t('prompt.add_files')}
        </button>
        <button className="prompt__btn--primary" onClick={() => onAnswer({ kind: "review_tracks", proceed: true })}>
          {t('prompt.looks_good')}
        </button>
        <button className="prompt__btn--danger" onClick={() => onAnswer({ kind: "review_tracks", proceed: false })}>
          {t('prompt.cancel')}
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
    </div>
  );
}
