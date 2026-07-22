import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search, ChevronLeft, Loader, Disc3, AlertTriangle } from "lucide-react";
import { apiFetch } from "../context/AuthContext";
import type { MetadataCandidate, ProviderResult } from "../types/metadataTypes";
import { applyFolderRenames } from "../utils/metadataRename";
import "./scss/AllMusicSearchFlow.scss";

// ── Types ─────────────────────────────────────────────────────────────────────

type AlbumResult = {
  mwid: string;
  title: string;
  artist: string;
  year: string | null;
  coverUrl: string | null;
};

type AlbumDetail = {
  mwid: string;
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  tracks: { pos: number; title: string }[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract mwid from a direct AllMusic URL or raw mwid string.
 *  Handles: https://www.allmusic.com/album/slug-mw0001234567
 *           https://www.allmusic.com/album/mw0001234567
 *           mw0001234567
 */
function extractMwid(input: string): string | null {
  const trimmed = input.trim();
  // Raw mwid
  if (/^mw\d{8,}$/i.test(trimmed)) return trimmed.toLowerCase();
  // URL: find last occurrence of mw followed by digits
  const match = trimmed.match(/mw(\d{8,})/i);
  if (match) return `mw${match[1]}`;
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  artist: string;
  album: string;
  onResult: (r: ProviderResult) => void;
  onBack: () => void;
};

export default function AllMusicSearchFlow({ artist, album, onResult, onBack }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(`${artist} ${album}`);
  const [directUrl, setDirectUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scraperBroken, setScraperBroken] = useState(false);
  const [results, setResults] = useState<AlbumResult[]>([]);

  useEffect(() => {
    doSearch(`${artist} ${album}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setScraperBroken(false);
    setResults([]);
    try {
      const r = await apiFetch(`/api/allmusic/search?q=${encodeURIComponent(q)}`);
      const data = await r.json();

      if (data.error === "scraper_broken") {
        setScraperBroken(true);
        setErr(data.message ?? "AllMusic page structure changed — scraper needs updating.");
        return;
      }
      if (!r.ok) {
        setErr(`Search failed: ${data.message ?? r.status}`);
        return;
      }

      const items: AlbumResult[] = data.data ?? [];
      setResults(items);
      if (items.length === 0) setErr(t("metadata.no_results"));
    } catch (e) {
      setErr(`Request failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function fetchByMwid(mwid: string) {
    setLoading(true);
    setErr(null);
    setScraperBroken(false);
    try {
      const r = await apiFetch(`/api/allmusic/album/${mwid}`);
      const data = await r.json();

      if (data.error === "scraper_broken") {
        setScraperBroken(true);
        setErr(data.message ?? "AllMusic page structure changed — scraper needs updating.");
        return;
      }
      if (!r.ok) {
        setErr(`Album fetch failed: ${data.message ?? r.status}`);
        return;
      }

      const detail: AlbumDetail = data;
      buildResult(detail);
    } catch (e) {
      setErr(`Request failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  function handleDirectUrl() {
    const mwid = extractMwid(directUrl);
    if (!mwid) {
      setErr("Could not find an AllMusic ID in that URL. Expected format: allmusic.com/album/…mw0001234567");
      return;
    }
    fetchByMwid(mwid);
  }

  function buildResult(detail: AlbumDetail) {
    const candidate: MetadataCandidate = {
      source: "allmusic",
      albumTitle: detail.title,
      artistName: detail.artist,
      year: detail.year,
      coverUrl: detail.coverUrl,
      tracks: detail.tracks,
      allMusicMwid: detail.mwid,
    };

    const providerResult: ProviderResult = {
      candidates: [candidate],
      apply: async (_index, options) => {
        const body = {
          cover_url: detail.coverUrl ?? "",
          album_title: detail.title,
          album_artist: detail.artist,
          year: detail.year,
          tracks: detail.tracks,
        };

        if (!options?.tagsOnly && detail.coverUrl) {
          const res = await apiFetch(
            `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/allmusic-cover`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          );
          if (!res.ok) throw new Error(`Cover apply failed: ${res.status}`);
        }
        if (!options?.coverOnly) {
          const res = await apiFetch(
            `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/allmusic-tags`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
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
  }

  async function selectAlbum(result: AlbumResult) {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiFetch(`/api/allmusic/album/${result.mwid}`);
      const data = await r.json();

      if (data.error === "scraper_broken") {
        setScraperBroken(true);
        setErr(data.message ?? "AllMusic album page structure changed — scraper needs updating.");
        return;
      }
      if (!r.ok) {
        setErr(`Album fetch failed: ${data.message ?? r.status}`);
        return;
      }

      buildResult(data as AlbumDetail);
    } catch (e) {
      setErr(`Failed to load album: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="am-flow">
      <div className="am-flow__search">
        <input
          className="am-flow__search__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doSearch(query); }}
          placeholder={t("metadata.album_placeholder")}
        />
        <button
          className="am-flow__search__btn"
          onClick={() => doSearch(query)}
          disabled={loading}
        >
          {loading
            ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
            : <Search size={14} />}
        </button>
      </div>

      {/* Direct URL paste */}
      <div className="am-flow__direct">
        <input
          className="am-flow__direct__input"
          value={directUrl}
          onChange={(e) => setDirectUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleDirectUrl(); }}
          placeholder={t("metadata.allmusic_direct_placeholder")}
        />
        <button
          className="am-flow__direct__btn"
          onClick={handleDirectUrl}
          disabled={loading || !directUrl.trim()}
        >
          {t("metadata.allmusic_direct_btn")}
        </button>
      </div>
      <p className="am-flow__direct-hint">
        {t("metadata.allmusic_direct_hint")}
        {" "}
        <span className="am-flow__direct-example">
          allmusic.com/album/never-mind-the-bollocks-mw0000190325
        </span>
      </p>

      <button className="am-flow__back" onClick={onBack}>
        <ChevronLeft size={14} /> {t("metadata.choose_provider")}
      </button>

      {scraperBroken && (
        <div className="am-flow__scraper-warning">
          <AlertTriangle size={15} />
          <span>{t("metadata.allmusic_broken")}</span>
        </div>
      )}

      {err && !scraperBroken && <div className="am-flow__error">{err}</div>}

      {!loading && results.length > 0 && (
        <div className="am-flow__results">
          {results.map((r) => (
            <button
              key={r.mwid}
              className="am-flow__result-row"
              onClick={() => selectAlbum(r)}
            >
              <div className="am-flow__result-row__art">
                {r.coverUrl
                  ? <img src={r.coverUrl} alt={r.title} loading="lazy" />
                  : <div className="am-flow__result-row__placeholder"><Disc3 size={20} /></div>
                }
              </div>
              <div className="am-flow__result-row__info">
                <span className="am-flow__result-row__title">{r.title}</span>
                <span className="am-flow__result-row__meta">
                  {[r.artist, r.year].filter(Boolean).join(" · ")}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="am-flow__loading">
          <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
          {t("metadata.loading")}
        </div>
      )}
    </div>
  );
}
