import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search, ChevronLeft, Loader, Disc3, User } from "lucide-react";
import { apiFetch } from "../context/AuthContext";
import {
  TidalArtist,
  TidalAlbum,
  coverProxyUrl,
} from "../pages/discover/discoverTypes";
import type { MetadataCandidate, ProviderResult } from "../types/metadataTypes";
import { applyFolderRenames } from "../utils/metadataRename";
import "./scss/TidalSearchFlow.scss";

type Props = {
  artist: string;
  album: string;
  onResult: (r: ProviderResult) => void;
  onBack: () => void;
};

type DiscoTab = "albums" | "eps" | "singles";
type DiscoSort = "year-desc" | "year-asc" | "name";

type FlowStep =
  | { kind: "search" }
  | { kind: "artist"; id: number; name: string };

function parseYear(date: string | undefined): number | null {
  if (!date) return null;
  const y = parseInt(date.slice(0, 4), 10);
  return isNaN(y) ? null : y;
}

function sortAlbums(arr: TidalAlbum[], sort: DiscoSort): TidalAlbum[] {
  return [...arr].sort((a, b) => {
    switch (sort) {
      case "year-asc":  return (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "");
      case "year-desc": return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
      case "name":      return a.title.localeCompare(b.title);
      default:          return 0;
    }
  });
}

export default function TidalSearchFlow({ artist, album, onResult, onBack }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(artist);
  const [step, setStep] = useState<FlowStep>({ kind: "search" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [artistResults, setArtistResults] = useState<TidalArtist[]>([]);
  const [discography, setDiscography] = useState<TidalAlbum[]>([]);
  const [tab, setTab] = useState<DiscoTab>("albums");
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
      const r = await apiFetch(`/api/discover/search?q=${encodeURIComponent(q)}&limit=10`);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      const artists: TidalArtist[] = data?.artists?.items ?? [];
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
      const r = await apiFetch(`/api/discover/artist/${id}/albums`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const items: TidalAlbum[] = Array.isArray(data) ? data : (data.items ?? []);
      setDiscography(items);
      setStep({ kind: "artist", id, name });
      const hasAlbums = items.some(a => a.type === "ALBUM" || !a.type);
      const hasEps    = items.some(a => a.type === "EP");
      setTab(hasAlbums ? "albums" : hasEps ? "eps" : "singles");
    } catch (e) {
      setErr(`Failed to load discography: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function selectAlbum(tidalAlbum: TidalAlbum, artistName: string) {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch(`/api/discover/album/${tidalAlbum.id}`);
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const items: { trackNumber?: number; title: string }[] =
        data?.tracks?.items ?? data?.items ?? [];

      const candidate: MetadataCandidate = {
        source: "tidal",
        albumTitle: tidalAlbum.title,
        artistName,
        year: parseYear(tidalAlbum.releaseDate),
        coverUrl: coverProxyUrl(tidalAlbum.cover),
        tracks: items.map((item, i) => ({
          pos: item.trackNumber ?? i + 1,
          title: item.title,
        })),
        tidalAlbumId: tidalAlbum.id,
      };

      const albumId = tidalAlbum.id;
      const providerResult: ProviderResult = {
        candidates: [candidate],
        apply: async (_index, options) => {
          if (!options?.tagsOnly) {
            const res = await apiFetch(
              `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/tidal-cover`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tidal_album_id: albumId }),
              }
            );
            if (!res.ok) throw new Error(`Cover apply failed: ${res.status}`);
          }
          if (!options?.coverOnly) {
            const res = await apiFetch(
              `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/tidal-tags`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tidal_album_id: albumId }),
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

  // ── Discography view ─────────────────────────────────────────────────────

  const fullAlbums = discography.filter(a => a.type === "ALBUM" || !a.type);
  const eps        = discography.filter(a => a.type === "EP");
  const singles    = discography.filter(a => a.type === "SINGLE");

  const effectiveTab: DiscoTab = (() => {
    if (tab === "albums"  && fullAlbums.length > 0) return "albums";
    if (tab === "eps"     && eps.length > 0)        return "eps";
    if (tab === "singles" && singles.length > 0)    return "singles";
    return fullAlbums.length ? "albums" : eps.length ? "eps" : "singles";
  })();

  const rawVisible = effectiveTab === "albums" ? fullAlbums : effectiveTab === "eps" ? eps : singles;
  const visibleAlbums = sortAlbums(rawVisible, sort);

  return (
    <div className="tidal-flow">
      {/* Search bar */}
      <div className="tidal-flow__search">
        <input
          className="tidal-flow__search__input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doSearch(query); }}
          placeholder={t("metadata.artist_placeholder")}
        />
        <button
          className="tidal-flow__search__btn"
          onClick={() => doSearch(query)}
          disabled={loading}
        >
          {loading
            ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
            : <Search size={14} />}
        </button>
      </div>

      {/* Back button */}
      <button className="tidal-flow__back" onClick={step.kind === "artist" ? () => setStep({ kind: "search" }) : onBack}>
        <ChevronLeft size={14} />
        {step.kind === "artist" ? t("metadata.results_back") : t("metadata.choose_provider")}
      </button>

      {err && <div className="tidal-flow__error">{err}</div>}

      {/* Artist results */}
      {step.kind === "search" && !loading && artistResults.length > 0 && (
        <div className="tidal-flow__artist-list">
          {artistResults.map(a => {
            const src = coverProxyUrl(a.picture);
            return (
              <button
                key={a.id}
                className="tidal-flow__artist-row"
                onClick={() => selectArtist(a.id, a.name)}
              >
                <div className="tidal-flow__artist-row__avatar">
                  {src ? <img src={src} alt={a.name} /> : <User size={18} />}
                </div>
                <span>{a.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Discography */}
      {step.kind === "artist" && !loading && (
        <>
          <div className="tidal-flow__disco-header">
            <div className="tidal-flow__tabs">
              {(
                [
                  ["albums", t("metadata.tab_albums"), fullAlbums.length],
                  ["eps",    t("metadata.tab_eps"),    eps.length],
                  ["singles",t("metadata.tab_singles"),singles.length],
                ] as [DiscoTab, string, number][]
              )
                .filter(([, , c]) => c > 0)
                .map(([key, label, count]) => (
                  <button
                    key={key}
                    className={`tidal-flow__tab${effectiveTab === key ? " tidal-flow__tab--active" : ""}`}
                    onClick={() => setTab(key)}
                  >
                    {label}
                    <span className="tidal-flow__tab-count">{count}</span>
                  </button>
                ))}
            </div>
            <select
              className="tidal-flow__sort"
              value={sort}
              onChange={e => setSort(e.target.value as DiscoSort)}
            >
              <option value="year-desc">{t("metadata.sort_year_desc")}</option>
              <option value="year-asc">{t("metadata.sort_year_asc")}</option>
              <option value="name">{t("metadata.sort_name")}</option>
            </select>
          </div>

          <div className="tidal-flow__album-grid">
            {visibleAlbums.map(a => {
              const cover = coverProxyUrl(a.cover);
              const year  = a.releaseDate?.slice(0, 4);
              const trackCount = a.numberOfTracks;
              const artistName = step.kind === "artist" ? step.name : artist;
              return (
                <button
                  key={a.id}
                  className="tidal-flow__album-card"
                  onClick={() => selectAlbum(a, artistName)}
                >
                  <div className="tidal-flow__album-card__art">
                    {cover
                      ? <img src={cover} alt={a.title} />
                      : <div className="tidal-flow__album-card__placeholder"><Disc3 size={24} /></div>
                    }
                  </div>
                  <div className="tidal-flow__album-card__info">
                    <span className="tidal-flow__album-card__title">{a.title}</span>
                    <span className="tidal-flow__album-card__meta">
                      {[year, trackCount ? `${trackCount} tracks` : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {loading && (
        <div className="tidal-flow__loading">
          <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
          Loading…
        </div>
      )}
    </div>
  );
}
