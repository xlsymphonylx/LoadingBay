import { useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Disc3, Tag, Mic2, Loader, CheckCircle, XCircle, Square, CheckSquare, Trash2 } from "lucide-react";
import { apiFetch } from "../../../context/AuthContext";
import { useInViewSrc } from "../../../hooks/useInViewSrc";
import "./AlbumCard.scss";

type LyricsState = "idle" | "running" | "done" | "error";

type Props = {
  artist: string;
  album: string;
  onTag: () => void;
  onClick: () => void;
  onDelete: (album: string) => void;
  selected?: boolean;
  selectMode?: boolean;
  onSelect?: () => void;
  bulkStatus?: "running" | "done" | "failed";
};

export default function AlbumCard({ artist, album, onTag, onClick, onDelete, selected, selectMode, onSelect, bulkStatus }: Props) {
  const { t } = useTranslation();
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const coverSrc = `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/cover`;
  const { ref: coverRef, activeSrc: coverActiveSrc } = useInViewSrc(coverSrc);
  const [lyrics, setLyrics] = useState<LyricsState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function fetchLyrics() {
    setLyrics("running");
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/lyrics`,
        { method: "POST" }
      );
      const data = await res.json();
      setLyrics(data.success ? "done" : "error");
    } catch {
      setLyrics("error");
    }
    setTimeout(() => setLyrics("idle"), 4000);
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        onDelete(album);
      } else if (res.status === 429) {
        alert(t('explorer.quota_reached'));
        setDeleting(false);
        setConfirmDelete(false);
      } else {
        setDeleting(false);
        setConfirmDelete(false);
      }
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const lyricsIcon =
    lyrics === "running" ? <Loader size={11} className="album-card__spin" /> :
    lyrics === "done"    ? <CheckCircle size={11} /> :
    lyrics === "error"   ? <XCircle size={11} /> :
    <Mic2 size={11} />;

  function handleCardClick() {
    if (confirmDelete) { setConfirmDelete(false); return; }
    if (selectMode) {
      onSelect?.();
    } else {
      onClick();
    }
  }

  return (
    <div
      className={["album-card", selected ? "album-card--selected" : "", confirmDelete ? "album-card--confirm-delete" : ""].filter(Boolean).join(" ")}
      onClick={handleCardClick}
    >
      <div className="album-card__cover-wrap" ref={coverRef as React.RefObject<HTMLDivElement>}>
        {coverActiveSrc && !imgFailed && (
          <img
            src={coverActiveSrc}
            alt={album}
            className="album-card__cover"
            style={{ opacity: imgLoaded ? 1 : 0 }}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgFailed(true)}
          />
        )}
        {(imgFailed || !coverActiveSrc || !imgLoaded) && (
          <div className="album-card__placeholder">
            <Disc3 size={32} color="var(--text-muted)" />
          </div>
        )}

        {selectMode && (
          <div className={["album-card__checkbox", selected ? "album-card__checkbox--checked" : ""].filter(Boolean).join(" ")}>
            {selected ? <CheckSquare size={15} /> : <Square size={15} />}
          </div>
        )}

        {bulkStatus && (
          <div className={`album-card__bulk-status album-card__bulk-status--${bulkStatus}`}>
            {bulkStatus === "running" && <Loader size={15} className="album-card__spin" />}
            {bulkStatus === "done"    && <CheckCircle size={15} />}
            {bulkStatus === "failed"  && <XCircle size={15} />}
          </div>
        )}

        {confirmDelete && (
          <div className="album-card__delete-overlay">
            <span>Delete?</span>
          </div>
        )}
      </div>

      <div className="album-card__info">
        <div className="album-card__name" title={album}>{album}</div>
        <button
          className={`album-card__lyrics-btn album-card__lyrics-btn--${lyrics}`}
          onClick={(e) => { e.stopPropagation(); fetchLyrics(); }}
          disabled={lyrics === "running"}
          title={t('explorer.fetch_lyrics')}
        >
          {lyricsIcon}
        </button>
        <button className="album-card__tag-btn" onClick={(e) => { e.stopPropagation(); onTag(); }}>
          <Tag size={11} />
        </button>
        <button
          className={`album-card__delete-btn${confirmDelete ? " album-card__delete-btn--confirm" : ""}`}
          onClick={handleDelete}
          disabled={deleting}
          title={confirmDelete ? t('explorer.delete_confirm_again') : t('explorer.delete_album')}
        >
          {deleting ? <Loader size={11} className="album-card__spin" /> : <Trash2 size={11} />}
        </button>
      </div>
    </div>
  );
}
