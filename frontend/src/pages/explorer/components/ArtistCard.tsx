import { useState } from "react";
import { Music2 } from "lucide-react";
import { useInViewSrc } from "../../../hooks/useInViewSrc";
import "./ArtistCard.scss";

type Props = {
  name: string;
  albumCount: number;
  totalSizeBytes?: number;
  onClick: () => void;
};

const PALETTE: [string, string][] = [
  ["#6366f1", "#8b5cf6"],
  ["#0ea5e9", "#06b6d4"],
  ["#f59e0b", "#ef4444"],
  ["#10b981", "#059669"],
  ["#ec4899", "#f43f5e"],
  ["#8b5cf6", "#6366f1"],
  ["#14b8a6", "#0ea5e9"],
  ["#f97316", "#fb923c"],
];

function nameToGradient(name: string): [string, string] {
  const hash = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return PALETTE[hash % PALETTE.length];
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(0)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function ArtistCard({ name, albumCount, totalSizeBytes, onClick }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [colors] = useState(() => nameToGradient(name));

  // Only fire the image request once the card scrolls into view.
  // Without this, rendering 200+ artists simultaneously fires 200 requests.
  const { ref, activeSrc } = useInViewSrc(`/api/music/${encodeURIComponent(name)}/image`);

  return (
    <button className="artist-card" onClick={onClick} ref={ref as React.RefObject<HTMLButtonElement>}>
      <div className="artist-card__image-wrap">
        {activeSrc && !imgFailed && (
          <img
            src={activeSrc}
            alt={name}
            className="artist-card__image"
            style={{ opacity: imgLoaded ? 1 : 0 }}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgFailed(true)}
          />
        )}
        {(!activeSrc || imgFailed || !imgLoaded) && (
          <div
            className="artist-card__avatar"
            style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}
          >
            {imgFailed
              ? <span className="artist-card__avatar__letter">{name[0]?.toUpperCase()}</span>
              : <Music2 size={28} color="rgba(255,255,255,0.6)" />
            }
          </div>
        )}
      </div>
      <div className="artist-card__info">
        <div className="artist-card__name" title={name}>{name}</div>
        <div className="artist-card__count">
          {albumCount} album{albumCount !== 1 ? "s" : ""}
          {totalSizeBytes !== undefined && totalSizeBytes > 0 && (
            <span className="artist-card__size"> · {fmtBytes(totalSizeBytes)}</span>
          )}
        </div>
      </div>
    </button>
  );
}
