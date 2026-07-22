import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Disc3, Tag, Mic2, FilePlus, Layers, Loader, CheckCircle, XCircle, ImagePlus, Upload, Pencil, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../../context/AuthContext";
import { usePlayer } from "../../../contexts/PlayerContext";
import DiscGroupModal from "./DiscGroupModal";
import "./AlbumDetailView.scss";

type TrackEntry = { filename: string; size_bytes: number; disc?: string; rel_path: string };
type LyricsState = "idle" | "running" | "done" | "error";
type FetchArtState = "idle" | "running" | "done" | "error";
type UploadState = "idle" | "uploading" | "ask_beets" | "error";
type RenameState = "idle" | "editing" | "saving" | "error";

type Props = {
  artist: string;
  album: string;
  onBack: () => void;
  onTag: () => void;
  onAlbumRenamed?: (newName: string) => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AlbumDetailView({ artist, album, onBack, onTag, onAlbumRenamed }: Props) {
  const { t } = useTranslation();
  const { play } = usePlayer();
  const [tracks, setTracks] = useState<TrackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lyrics, setLyrics] = useState<LyricsState>("idle");
  const [fetchArt, setFetchArt] = useState<FetchArtState>("idle");
  const [upload, setUpload] = useState<UploadState>("idle");
  const [coverTs, setCoverTs] = useState<number>(0);
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [renameState, setRenameState] = useState<RenameState>("idle");
  const [albumName, setAlbumName] = useState(album);
  const [renameInput, setRenameInput] = useState(album);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deletingTrack, setDeletingTrack] = useState<string | null>(null);
  const [discGroupOpen, setDiscGroupOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/tracks`
      );
      setTracks(await res.json());
    } finally {
      setLoading(false);
    }
  }, [artist, albumName]);

  useEffect(() => { loadTracks(); }, [loadTracks]);

  async function fetchLyrics() {
    setLyrics("running");
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/lyrics`,
        { method: "POST" }
      );
      const data = await res.json();
      setLyrics(data.success ? "done" : "error");
    } catch {
      setLyrics("error");
    }
    setTimeout(() => setLyrics("idle"), 4000);
  }

  async function doFetchArt() {
    setFetchArt("running");
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/fetchart`,
        { method: "POST" }
      );
      const data = await res.json();
      setFetchArt(data.success ? "done" : "error");
      if (data.success) {
        setImgFailed(false);
        setImgLoaded(false);
        setCoverTs(Date.now());
      }
    } catch {
      setFetchArt("error");
    }
    setTimeout(() => setFetchArt("idle"), 4000);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    setUpload("uploading");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file, file.name));
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/tracks`,
        { method: "POST", body: form }
      );
      if (res.ok) {
        await loadTracks();
        setUpload("ask_beets");
      } else {
        const data = await res.json().catch(() => ({}));
        console.error("Track upload failed:", data.error);
        setUpload("error");
        setTimeout(() => setUpload("idle"), 4000);
      }
    } catch {
      setUpload("error");
      setTimeout(() => setUpload("idle"), 4000);
    }
  }

  async function handleModalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/cover`,
        { method: "POST", body: form }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setImgFailed(false); setImgLoaded(false); setCoverTs(Date.now());
      }
    } catch { /* ignore */ }
  }

  function startRename() {
    setRenameInput(albumName);
    setRenameError(null);
    setRenameState("editing");
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  async function commitRename() {
    const trimmed = renameInput.trim();
    if (trimmed === albumName) {
      setRenameState("idle");
      return;
    }
    setRenameState("saving");
    setRenameError(null);
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed }) }
      );
      if (res.ok) {
        const data = await res.json();
        setAlbumName(data.album);
        onAlbumRenamed?.(data.album);
        setRenameState("idle");
      } else {
        const data = await res.json().catch(() => ({}));
        setRenameError(data.error ?? "Rename failed");
        setRenameInput(albumName);
        setRenameState("error");
        setTimeout(() => setRenameState("idle"), 4000);
      }
    } catch {
      setRenameError("Network error");
      setRenameInput(albumName);
      setRenameState("error");
      setTimeout(() => setRenameState("idle"), 4000);
    }
  }

  async function deleteTrack(track: TrackEntry) {
    if (!confirm(`Delete "${track.filename}"? This cannot be undone.`)) return;
    setDeletingTrack(track.rel_path);
    try {
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/tracks/${track.rel_path.split('/').map(encodeURIComponent).join('/')}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setTracks(prev => prev.filter(t => t.rel_path !== track.rel_path));
      } else {
        const text = await res.text().catch(() => String(res.status));
        alert(`Delete failed: ${text}`);
      }
    } catch (e) {
      alert(`Delete failed: ${e}`);
    } finally {
      setDeletingTrack(null);
    }
  }

  const lyricsIcon =
    lyrics === "running" ? <Loader size={13} className="album-detail__spin" /> :
    lyrics === "done"    ? <CheckCircle size={13} /> :
    lyrics === "error"   ? <XCircle size={13} /> :
    <Mic2 size={13} />;

  const fetchArtIcon =
    fetchArt === "running" ? <Loader size={13} className="album-detail__spin" /> :
    fetchArt === "done"    ? <CheckCircle size={13} /> :
    fetchArt === "error"   ? <XCircle size={13} /> :
    <ImagePlus size={13} />;

  const coverUrl = `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/cover${coverTs ? `?t=${coverTs}` : ""}`;

  return (
    <div className="album-detail">
      <div className="album-detail__header">
        <button className="album-detail__back" onClick={onBack}>
          <ChevronLeft size={16} />
          {t('explorer.back_to_artists')}
        </button>
        <span className="album-detail__breadcrumb">
          <span className="album-detail__breadcrumb__artist">{artist}</span>
          <span className="album-detail__breadcrumb__sep"> / </span>
          {renameState === "editing" || renameState === "saving" ? (
            <span className="album-detail__rename-wrap">
              <input
                ref={renameInputRef}
                className="album-detail__rename-input"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setRenameInput(albumName); setRenameState("idle"); }
                }}
                onBlur={commitRename}
                disabled={renameState === "saving"}
              />
              {renameState === "saving" && <Loader size={12} className="album-detail__spin" />}
            </span>
          ) : (
            <span className="album-detail__breadcrumb__album">
              {albumName}
              {renameState === "error" && renameError && (
                <span className="album-detail__rename-error">{renameError}</span>
              )}
              <button className="album-detail__rename-btn" onClick={startRename} title={t('explorer.rename_album')}>
                <Pencil size={11} />
              </button>
            </span>
          )}
        </span>
        <div className="album-detail__header__spacer" />
        <button
          className={`album-detail__fetchart-btn album-detail__fetchart-btn--${fetchArt}`}
          onClick={doFetchArt}
          disabled={fetchArt === "running"}
          title="Fetch album art via beets"
        >
          {fetchArtIcon}
          {t('explorer.cover')}
        </button>
        <button
          className={`album-detail__lyrics-btn album-detail__lyrics-btn--${lyrics}`}
          onClick={fetchLyrics}
          disabled={lyrics === "running"}
          title="Fetch lyrics"
        >
          {lyricsIcon}
          {t('explorer.lyrics_all')}
        </button>
        <button className="album-detail__tag-btn" onClick={onTag} title={t('explorer.bulk_tag', { n: 1 })}>
          <Tag size={13} />
          {t('import.tag')}
        </button>
        <button className="album-detail__disc-btn" onClick={() => setDiscGroupOpen(true)} title="Manage disc groups">
          <Layers size={13} />
          Discs
        </button>
      </div>

      <div className="album-detail__body">
        <div className="album-detail__tracks">
          {loading ? (
            <div className="album-detail__tracks__loading">
              <Loader size={20} className="album-detail__spin" />
            </div>
          ) : tracks.length === 0 ? (
            <div className="album-detail__tracks__empty">No audio files found</div>
          ) : (
            <ul className="album-detail__track-list">
              {tracks.map((track) => (
                <li key={track.rel_path} className="album-detail__track-item">
                  <button
                    className="album-detail__play-btn"
                    title={t('explorer.play')}
                    onClick={() => play({
                      title: track.filename,
                      artist: artist,
                      src: `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(albumName)}/stream/${track.rel_path.split('/').map(encodeURIComponent).join('/')}`,
                    })}
                  >
                    <Play size={12} />
                  </button>
                  <span className="album-detail__track-item__name">
                    {track.disc && <span className="album-detail__track-disc-badge">{track.disc}</span>}
                    {track.filename}
                  </span>
                  <span className="album-detail__track-item__size">{formatBytes(track.size_bytes)}</span>
                  <button
                    className="album-detail__track-delete-btn"
                    title={t('explorer.delete_track')}
                    disabled={deletingTrack === track.rel_path}
                    onClick={() => deleteTrack(track)}
                  >
                    {deletingTrack === track.rel_path
                      ? <Loader size={11} className="album-detail__spin" />
                      : <Trash2 size={11} />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="album-detail__upload">
            {upload === "ask_beets" ? (
              <div className="album-detail__beets-prompt">
                <span>Track added — update metadata with beets?</span>
                <div className="album-detail__beets-prompt__actions">
                  <button onClick={() => { setUpload("idle"); onTag(); }}>Yes</button>
                  <button onClick={() => setUpload("idle")}>No</button>
                </div>
              </div>
            ) : upload === "error" ? (
              <div className="album-detail__beets-prompt album-detail__beets-prompt--error">
                Upload failed
              </div>
            ) : (
              <button
                className="album-detail__add-btn"
                onClick={() => fileRef.current?.click()}
                disabled={upload === "uploading"}
                title="Add missing track"
              >
                {upload === "uploading"
                  ? <Loader size={13} className="album-detail__spin" />
                  : <FilePlus size={13} />}
                Add missing track
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.ape,.wv,.aiff,.aif"
              multiple
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>
        </div>

        <div className="album-detail__cover-wrap">
          {!imgFailed && (
            <img
              src={coverUrl}
              alt={albumName}
              className="album-detail__cover"
              style={{ opacity: imgLoaded ? 1 : 0 }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgFailed(true)}
            />
          )}
          {(imgFailed || !imgLoaded) && (
            <div className="album-detail__cover-placeholder">
              <Disc3 size={64} color="var(--text-muted)" />
            </div>
          )}
          <div
            className="album-detail__cover-overlay"
            onClick={() => coverFileRef.current?.click()}
          >
            <Upload size={24} color="white" />
            <span className="album-detail__cover-overlay__label">{t('explorer.change_cover')}</span>
          </div>
          <input
            ref={coverFileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleModalUpload}
          />
        </div>
      </div>
      {discGroupOpen && (
        <DiscGroupModal
          artist={artist}
          album={albumName}
          tracks={tracks}
          onClose={() => setDiscGroupOpen(false)}
          onApplied={() => { setDiscGroupOpen(false); loadTracks(); }}
        />
      )}
    </div>
  );
}
