import { useState, useEffect, useRef } from "react";
import { Download, Disc3, Loader2, Link, Play, Pause } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../context/AuthContext";
import { usePlayer } from "../../contexts/PlayerContext";
import { TidalArtist, TidalAlbumDetail, LazyTidalImg, fmtDuration } from "./discoverTypes";
import "./AlbumView.scss";

export function AlbumView({
  albumId,
  highlightedTrackId,
  onArtist,
  onShowToast,
  LoadingSpinner,
  ErrorBox,
}: {
  albumId: number;
  highlightedTrackId?: number | null;
  onArtist: (a: TidalArtist) => void;
  onShowToast: (msg: string) => void;
  LoadingSpinner: () => React.ReactElement;
  ErrorBox: (props: { msg: string }) => React.ReactElement;
}) {
  const { t } = useTranslation();
  const [album, setAlbum] = useState<TidalAlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dlState, setDlState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [dlMsg, setDlMsg] = useState("");
  const player = usePlayer();
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch(`/api/discover/album/${albumId}`);
        if (!r.ok) throw new Error(await r.text());
        setAlbum(await r.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  // Auto-scroll to highlighted track after album loads
  useEffect(() => {
    if (highlightedTrackId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [album, highlightedTrackId]);

  const handleDownload = async () => {
    if (!album) return;
    setDlState("loading");
    setDlMsg("");
    try {
      const r = await apiFetch("/api/discover/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ album_id: album.id }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDlState("done");
      setDlMsg("");
    } catch (e) {
      setDlState("error");
      setDlMsg(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBox msg={error} />;
  if (!album) return null;

  const tracks = album.tracks?.items ?? [];
  const artistName = (album.artist ?? album.artists?.[0])?.name ?? "";

  const handleShareAlbum = () => {
    const url = `${window.location.origin}${window.location.pathname}?view=album&id=${album.id}`;
    navigator.clipboard.writeText(url).then(() => onShowToast(t('discover.link_copied'))).catch(() => onShowToast("Copy failed"));
  };

  const handleShareTrack = (trackId: number) => {
    const url = `${window.location.origin}${window.location.pathname}?view=album&id=${album.id}&track=${trackId}`;
    navigator.clipboard.writeText(url).then(() => onShowToast(t('discover.link_copied'))).catch(() => onShowToast("Copy failed"));
  };

  return (
    <div className="discover__album">
      <div className="discover__album-hero">
        <div className="discover__album-cover">
          <LazyTidalImg
            uuid={album.cover}
            alt={album.title}
            fallback={<div className="discover-card__placeholder"><Disc3 size={48} /></div>}
          />
        </div>
        <div className="discover__album-meta">
          <h2 className="discover__album-title">{album.title}</h2>
          {(() => {
            const a = album.artist ?? album.artists?.[0];
            return a ? (
              <button
                className="discover__album-artist discover__album-artist--link"
                onClick={() => onArtist({ id: a.id, name: a.name })}
              >
                {a.name}
              </button>
            ) : null;
          })()}
          <p className="discover__album-info">
            {album.releaseDate?.slice(0, 4)} · {album.numberOfTracks ?? tracks.length} tracks
          </p>
          <button
            className={`discover__dl-btn discover__dl-btn--${dlState}`}
            onClick={handleDownload}
            disabled={dlState === "loading" || dlState === "done"}
          >
            {dlState === "loading" ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
            {dlState === "idle"    && t('discover.download_to_library')}
            {dlState === "loading" && t('discover.downloading')}
            {dlState === "done"    && t('discover.download_started')}
            {dlState === "error"   && t('discover.retry')}
          </button>
          <button className="discover__share-btn discover__share-btn--album" onClick={handleShareAlbum} title={t('discover.copy_album_link')}>
            <Link size={14} /> {t('discover.share')}
          </button>
          {dlMsg && (
            <p className={`discover__dl-msg discover__dl-msg--${dlState}`}>{dlMsg}</p>
          )}
        </div>
      </div>

      {tracks.length > 0 && (
        <ol className="discover__tracklist">
          {tracks.map(track => {
            const isHighlighted = highlightedTrackId === track.id;
            const isCurrentlyPlaying = player.playing && player.track?.trackId === track.id;
            const isLoaded = player.track?.trackId === track.id;
            return (
              <li
                key={track.id}
                ref={isHighlighted ? highlightRef : null}
                className={`discover__track${isHighlighted ? " discover__track-highlight" : ""}`}
              >
                <span className="discover__track-num">{track.trackNumber}</span>
                <span className="discover__track-title">{track.title}</span>
                {track.duration && <span className="discover__track-dur">{fmtDuration(track.duration)}</span>}
                <button
                  className="discover__track-play-btn"
                  title={isCurrentlyPlaying ? t('discover.pause_preview') : t('discover.play_preview')}
                  onClick={() => {
                    if (isCurrentlyPlaying) {
                      player.pause();
                    } else if (isLoaded) {
                      player.resume();
                    } else {
                      player.play({
                        trackId: track.id,
                        title: track.title,
                        artist: artistName,
                        albumArt: album.cover,
                        albumId: album.id,
                      });
                    }
                  }}
                >
                  {isCurrentlyPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  className="discover__share-btn"
                  title={t('discover.copy_track_link')}
                  onClick={() => handleShareTrack(track.id)}
                >
                  <Link size={12} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
