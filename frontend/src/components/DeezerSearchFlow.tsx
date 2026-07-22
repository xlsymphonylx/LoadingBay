import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search, ChevronLeft, Loader, Disc3, User } from "lucide-react";
import { apiFetch } from "../context/AuthContext";
import type { MetadataCandidate, ProviderResult } from "../types/metadataTypes";
import { applyFolderRenames } from "../utils/metadataRename";
import "./scss/DeezerSearchFlow.scss";

// ── Deezer types ─────────────────────────────────────────────────────────────

type DeezerArtist = {
  id: number;
  name: string;
  picture_medium: string;
  picture_xl: string;
  nb_album: number;
};

type DeezerAlbumSummary = {
  id: number;
  title: string;
  cover_medium: string;
  cover_xl: string;
  release_date: string;
  nb_tracks: number;
  record_type: "album" | "ep" | "single";
};

type DeezerTrack = {
  id: number;
  title: string;
  track_position: number;
};

type DeezerAlbumFull = DeezerAlbumSummary & {
  artist: { name: string };
  tracks: { data: DeezerTrack[] };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type DiscoTab = "album" | "ep" | "single";
type DiscoSort = "year-desc" | "year-asc" | "name";

function sortAlbums(arr: DeezerAlbumSummary[], sort: DiscoSort): DeezerAlbumSummary[] {
  return [...arr].sort((a, b) => {
    switch (sort) {
      case "year-asc":  return a.release_date.localeCompare(b.release_date);
      case "year-desc": return b.release_date.localeCompare(a.release_date);
      case "name":      return a.title.localeCompare(b.title);
      default:          return 0;
    }
  });
}

function parseYear(date: string): number | null {
  const y = parseInt(date?.slice(0, 4), 10);
  return isNaN(y) ? null : y;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  artist: string;
  album: string;
  onResult: (r: ProviderResult) => void;
  onBack: () => void;
};

type FlowStep =
  | { kind: "search" }
  | { kind: "artist"; id: number; name: string };

export default function DeezerSearchFlow({ artist, album, onResult, onBack }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(artist);
  const [step, setStep] = useState<FlowStep>({ kind: "search" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [artistResults, setArtistResults] = useState<DeezerArtist[]>([]);
  const [discography, setDiscography] = useState<DeezerAlbumSummary[]>([]);
  const [tab, setTab] = useState<DiscoTab>("album");
  const [sort, setSort] = useState<DiscoSort>("year-desc");

  useEffect(() => {
    doSearch(artist);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(q: string) {
    setLoading(true);
    setErr(null);
    setArtistResults([]);
    setStep({ kind: "search" });
    try {
      const r = await apiFetch(`/api/discover/deezer/search?q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      const artists: DeezerArtist[] = data?.data ?? [];
      setArtistResults(artists.slice(0, 5));
      if (artists.length === 0) setErr(t("metadata.no_artists"));
    } catch (e) {
      setErr(`Search failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function selectArtist(id: number, name: string) {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch(`/api/discover/deezer/artist/${id}/albums`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const items: DeezerAlbumSummary[] = data?.data ?? [];
      setDiscography(items);
      setStep({ kind: "artist", id, name });
      // Default to first non-empty tab
      const hasAlbums  = items.some(a => a.record_type === "album");
      const hasEps     = items.some(a => a.record_type === "ep");
      setTab(hasAlbums ? "album" : hasEps ? "ep" : "single");
    } catch (e) {
      setErr(`Failed to load discography: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function selectAlbum(summary: DeezerAlbumSummary, artistName: string) {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch(`/api/discover/deezer/album/${summary.id}`);
      if (!r.ok) throw new Error(await r.text());
      const data: DeezerAlbumFull = await r.json();

      const candidate: MetadataCandidate = {
        source: "deezer",
        albumTitle: data.title,
        artistName: data.artist?.name ?? artistName,
        year: parseYear(data.release_date),
        coverUrl: data.cover_xl || data.cover_medium || null,
        tracks: (data.tracks?.data ?? []).map(t => ({
          pos: t.track_position,
          title: t.title,
        })),
        deezerAlbumId: data.id,
      };

      const albumId = data.id;
      const providerResult: ProviderResult = {
        candidates: [candidate],
        apply: async (_index, options) => {
          if (!options?.tagsOnly) {
            const res = await apiFetch(
              `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/deezer-cover`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deezer_album_id: albumId }),
              }
            );
            if (!res.ok) throw new Error(`Cover apply failed: ${res.status}`);
          }
          if (!options?.coverOnly) {
            const res = await apiFetch(
              `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/deezer-tags`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deezer_album_id: albumId }),
              }
            );
            if (!res.ok) throw new Error(`Tags apply failed: ${res.status}`);
            const result = await res.json().catch(() => null);
            if (result && result.tagged === 0 && result.total > 0) {
              throw new Error(`Tags applied but 0/${result.total} tracks were written. Check server logs.`);
            }
          }
          await applyFolderRenames(artist, album, options);
        },
      };

      onResult(providerResult);
    } catch (e) {
      setErr(`Failed to load album: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Discography derived state ─────────────────────────────────────────────

  const albums  = discography.filter(a => a.record_type === "album");
  const eps     = discography.filter(a => a.record_type === "ep");
  const singles = discography.filter(a => a.record_type === "single");

  const effectiveTab: DiscoTab = (() => {
    if (tab === "album"  && albums.length > 0)  return "album";
    if (tab === "ep"     && eps.length > 0)     return "ep";
    if (tab === "single" && singles.length > 0) return "single";
    return albums.length ? "album" : eps.length ? "ep" : "single";
  })();

  const rawVisible =
    effectiveTab === "album" ? albums : effectiveTab === "ep" ? eps : singles;
  const visibleAlbums = sortAlbums(rawVisible, sort);

  return (
    <div className="deezer-flow">
      {/* Search bar */}
      <div className="deezer-flow__search">
        <input
          className="deezer-flow__search__input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(query); }}
          placeholder={t("metadata.artist_placeholder")}
        />
        <button
          className="deezer-flow__search__btn"
          onClick={() => doSearch(query)}
          disabled={loading}
        >
          {loading
            ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
            : <Search size={14} />}
        </button>
      </div>

      {/* Back button */}
      <button
        className="deezer-flow__back"
        onClick={step.kind === "artist" ? () => setStep({ kind: "search" }) : onBack}
      >
        <ChevronLeft size={14} />
        {step.kind === "artist" ? t("metadata.results_back") : t("metadata.choose_provider")}
      </button>

      {err && <div className="deezer-flow__error">{err}</div>}

      {/* Artist results */}
      {step.kind === "search" && !loading && artistResults.length > 0 && (
        <div className="deezer-flow__artist-list">
          {artistResults.map(a => (
            <button
              key={a.id}
              className="deezer-flow__artist-row"
              onClick={() => selectArtist(a.id, a.name)}
            >
              <div className="deezer-flow__artist-row__avatar">
                {a.picture_medium
                  ? <img src={a.picture_medium} alt={a.name} />
                  : <User size={18} />}
              </div>
              <span>{a.name}</span>
              {a.nb_album > 0 && (
                <span className="deezer-flow__artist-row__albums">{a.nb_album} albums</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Discography */}
      {step.kind === "artist" && !loading && (
        <>
          <div className="deezer-flow__disco-header">
            <div className="deezer-flow__tabs">
              {(
                [
                  ["album",  t("metadata.tab_albums"),  albums.length],
                  ["ep",     t("metadata.tab_eps"),     eps.length],
                  ["single", t("metadata.tab_singles"), singles.length],
                ] as [DiscoTab, string, number][]
              )
                .filter(([, , c]) => c > 0)
                .map(([key, label, count]) => (
                  <button
                    key={key}
                    className={`deezer-flow__tab${effectiveTab === key ? " deezer-flow__tab--active" : ""}`}
                    onClick={() => setTab(key)}
                  >
                    {label}
                    <span className="deezer-flow__tab-count">{count}</span>
                  </button>
                ))}
            </div>
            <select
              className="deezer-flow__sort"
              value={sort}
              onChange={e => setSort(e.target.value as DiscoSort)}
            >
              <option value="year-desc">{t("metadata.sort_year_desc")}</option>
              <option value="year-asc">{t("metadata.sort_year_asc")}</option>
              <option value="name">{t("metadata.sort_name")}</option>
            </select>
          </div>

          <div className="deezer-flow__album-grid">
            {visibleAlbums.map(a => {
              const year = a.release_date?.slice(0, 4);
              const artistName = step.kind === "artist" ? step.name : artist;
              return (
                <button
                  key={a.id}
                  className="deezer-flow__album-card"
                  onClick={() => selectAlbum(a, artistName)}
                >
                  <div className="deezer-flow__album-card__art">
                    {a.cover_medium
                      ? <img src={a.cover_medium} alt={a.title} />
                      : <div className="deezer-flow__album-card__placeholder"><Disc3 size={24} /></div>
                    }
                  </div>
                  <div className="deezer-flow__album-card__info">
                    <span className="deezer-flow__album-card__title">{a.title}</span>
                    <span className="deezer-flow__album-card__meta">
                      {[year, a.nb_tracks ? `${a.nb_tracks} tracks` : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {loading && (
        <div className="deezer-flow__loading">
          <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
          {t("metadata.loading")}
        </div>
      )}
    </div>
  );
}
