import { Play, Pause, X, Volume2, Music } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlayer } from "../contexts/PlayerContext";
import "./MiniPlayer.scss";

function tidalCoverUrl(uuid: string | undefined): string | null {
  if (!uuid) return null;
  return `https://resources.tidal.com/images/${uuid.replace(/-/g, "/")}/320x320.jpg`;
}

export default function MiniPlayer() {
  const { t } = useTranslation();
  const { track, playing, currentTime, duration, volume, pause, resume, stop, seek, setVolume } = usePlayer();

  if (!track) return null;

  const coverUrl = tidalCoverUrl(track.albumArt);

  return (
    <div className="mini-player">
      <div className="mini-player__left">
        {coverUrl ? (
          <img src={coverUrl} alt={track.title} className="mini-player__art" />
        ) : (
          <div className="mini-player__art-placeholder">
            <Music size={20} />
          </div>
        )}
        <div className="mini-player__info">
          <span className="mini-player__title">{track.title}</span>
          <span className="mini-player__artist">{track.artist}</span>
        </div>
      </div>

      <div className="mini-player__center">
        <input
          type="range"
          className="mini-player__progress"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={e => seek(Number(e.target.value))}
        />
      </div>

      <div className="mini-player__right">
        <button
          className="mini-player__btn"
          onClick={() => (playing ? pause() : resume())}
          title={playing ? t('explorer.pause') : t('explorer.play')}
        >
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <div className="mini-player__volume">
          <Volume2 size={16} aria-label={t('player.volume')} />
          <input
            type="range"
            className="mini-player__volume-slider"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={e => setVolume(Number(e.target.value))}
          />
        </div>
        <button className="mini-player__btn mini-player__btn--close" onClick={stop} title="Close player">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
