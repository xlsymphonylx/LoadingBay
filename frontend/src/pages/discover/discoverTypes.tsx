import { useState } from "react";
import { CheckCircle, AlertTriangle, RadioTower } from "lucide-react";
import { useInViewSrc } from "../../hooks/useInViewSrc";
import { useHoverSrc } from "../../hooks/useHoverSrc";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LibraryArtist = { name: string; album_count: number };
export type LibraryAlbum  = { artist: string; album: string; track_count: number; quality: string };

export type TidalArtist = {
  id: number;
  name: string;
  picture?: string;
};

export type TidalAlbum = {
  id: number;
  title: string;
  cover?: string;
  releaseDate?: string;
  numberOfTracks?: number;
  type?: "ALBUM" | "EP" | "SINGLE";
  artist?: { id: number; name: string };
  artists?: { id: number; name: string }[];
};

export type TidalTrack = {
  id: number;
  trackNumber: number;
  title: string;
  duration?: number;
  artists?: { id: number; name: string; type?: string }[];
  album?: { id: number; title: string; cover?: string; releaseDate?: string };
};

export type TidalAlbumDetail = TidalAlbum & {
  tracks?: { items: TidalTrack[] };
};

export type SearchResults = {
  artists?: { items: TidalArtist[] };
  albums?: { items: TidalAlbum[] };
  tracks?: { items: TidalTrack[] };
};

export type View =
  | { kind: "search" }
  | { kind: "artist"; id: number; name: string }
  | { kind: "album"; id: number; artistName?: string };

// ── Ownership matching ────────────────────────────────────────────────────────

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")  // strip (Deluxe Edition) etc
    .replace(/\s*\[.*?\]\s*/g, " ")  // strip [2024 Remaster] etc
    .replace(/[^a-z0-9]/g, "")       // keep only alphanum
    .trim();
}

export type OwnedStatus = { owned: boolean; partial: boolean; lq: boolean };

export function checkOwned(
  tidalTitle: string,
  tidalArtist: string | undefined,
  tidalTrackCount: number | undefined,
  index: LibraryAlbum[],
): OwnedStatus {
  const nt = normalizeTitle(tidalTitle);
  const na = tidalArtist ? normalizeTitle(tidalArtist) : null;
  const match = index.find(lib => {
    if (normalizeTitle(lib.album) !== nt) return false;
    if (na) {
      const la = normalizeTitle(lib.artist);
      if (!la.includes(na) && !na.includes(la)) return false;
    }
    return true;
  });
  if (!match) return { owned: false, partial: false, lq: false };
  const partial = tidalTrackCount !== undefined && match.track_count < tidalTrackCount;
  const lq = match.quality === "LOSSY" || match.quality === "MIXED";
  return { owned: true, partial, lq };
}

export function OwnedBadge({ status }: { status: OwnedStatus }) {
  if (!status.owned) return null;
  return (
    <div className="discover-card__badges">
      {status.partial
        ? <span className="discover-card__badge discover-card__badge--partial" title="You have this album but with fewer tracks">
            <AlertTriangle size={10} />
          </span>
        : <span className="discover-card__badge discover-card__badge--owned" title="Already in your library">
            <CheckCircle size={10} />
          </span>
      }
      {status.lq && (
        <span className="discover-card__badge discover-card__badge--lq" title="Your copy is lossy quality — download FLAC to upgrade">
          <RadioTower size={10} />
        </span>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Routes Tidal cover art through the backend proxy which caches to disk
 * permanently and rate-limits outbound Tidal CDN requests.
 */
export function coverProxyUrl(uuid: string | undefined): string | null {
  if (!uuid) return null;
  return `/api/discover/cover/${uuid}`;
}

export function fmtDuration(seconds?: number): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Convert a TIDAL UUID (e.g. "abc-def-ghi") to a direct CDN image URL. */
export function tidalCoverUrl(uuid: string | undefined, size: "160x160" | "320x320" = "320x320"): string | null {
  if (!uuid) return null;
  return `https://resources.tidal.com/images/${uuid.replace(/-/g, "/")}/${size}.jpg`;
}

/**
 * Lazy-loads a Tidal cover via the backend proxy.
 * Defers the request until the container scrolls into view.
 */
export function LazyTidalImg({ uuid, alt, fallback }: {
  uuid: string | undefined;
  alt: string;
  fallback: React.ReactNode;
}) {
  const src = coverProxyUrl(uuid) ?? "";
  const { ref, activeSrc } = useInViewSrc(src);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className="discover-card__art-inner">
      {activeSrc && !failed ? (
        <>
          <img
            src={activeSrc}
            alt={alt}
            className="discover-card__img"
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
          {!loaded && fallback}
        </>
      ) : (
        fallback
      )}
    </div>
  );
}

/**
 * Like LazyTidalImg but defers the image request until the user hovers.
 * Useful for search results where many cards appear at once.
 */
export function HoverTidalImg({ uuid, alt, fallback }: {
  uuid: string | undefined;
  alt: string;
  fallback: React.ReactNode;
}) {
  const src = coverProxyUrl(uuid) ?? "";
  const { activeSrc, onMouseEnter } = useHoverSrc(src);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="discover-card__art-inner" onMouseEnter={onMouseEnter}>
      {activeSrc && !failed ? (
        <>
          <img
            src={activeSrc}
            alt={alt}
            className="discover-card__img"
            style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.2s" }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
          {!loaded && fallback}
        </>
      ) : (
        fallback
      )}
    </div>
  );
}
