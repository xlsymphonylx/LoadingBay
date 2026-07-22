import { useState, useCallback, useRef, useEffect } from "react";
import { Search, ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../context/AuthContext";
import { SearchResults, LibraryArtist, LibraryAlbum, TidalArtist, TidalAlbum, View } from "./discoverTypes";
import { SearchView } from "./SearchView";
import { ArtistView } from "./ArtistView";
import { AlbumView } from "./AlbumView";
import "./DiscoverPage.scss";

// ── Shared micro-components ───────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="discover__loading"><Loader2 size={32} className="spin" /></div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="discover__error"><AlertCircle size={16} /> {msg}</div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const { t } = useTranslation();
  // Navigation stack — first entry is always { kind: "search" }
  const [history, setHistory] = useState<View[]>([{ kind: "search" }]);
  const view = history[history.length - 1];

  const push = useCallback((v: View) => setHistory(h => [...h, v]), []);
  const pop  = useCallback(() => setHistory(h => h.length > 1 ? h.slice(0, -1) : h), []);

  // Search state — survives back-navigation since it lives here, not in sub-views
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feature B: highlighted track (from URL param)
  const [highlightedTrackId, setHighlightedTrackId] = useState<number | null>(null);

  // Feature B: toast notification
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast({ msg, key: Date.now() });
    toastTimeout.current = setTimeout(() => setToast(null), 2000);
  }, []);

  // Feature B: parse URL params on mount to deep-link into a view
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    const idParam = params.get("id");
    const trackParam = params.get("track");
    if (viewParam === "album" && idParam) {
      push({ kind: "album", id: Number(idParam) });
      if (trackParam) setHighlightedTrackId(Number(trackParam));
    } else if (viewParam === "artist" && idParam) {
      push({ kind: "artist", id: Number(idParam), name: "" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Library artists used for suggestions
  const [libraryArtists, setLibraryArtists] = useState<LibraryArtist[]>([]);
  const [libraryIndex, setLibraryIndex] = useState<LibraryAlbum[]>([]);

  useEffect(() => {
    apiFetch("/api/music")
      .then(r => r.ok ? r.json() : [])
      .then((data: LibraryArtist[]) => setLibraryArtists(data))
      .catch(() => {});
    apiFetch("/api/music/library-index")
      .then(r => r.ok ? r.json() : [])
      .then((data: LibraryAlbum[]) => setLibraryIndex(data))
      .catch(() => {});
  }, []);

  const fireSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); return; }
    setSearching(true);
    setSearchError(null);
    try {
      const r = await apiFetch(`/api/discover/search?q=${encodeURIComponent(q)}&limit=20`);
      if (!r.ok) throw new Error(await r.text());
      const json = await r.json();
      // backend merges artists+albums server-side, no envelope
      setResults(json);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) { setResults(null); return; }
    searchTimeout.current = setTimeout(() => fireSearch(q), 400);
  }, [fireSearch]);

  // Click a library artist chip -> fill query and search immediately
  const handleLibrarySuggestion = useCallback((name: string) => {
    setQuery(name);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    fireSearch(name);
  }, [fireSearch]);

  // Library artists filtered by current query (instant, no API call)
  const filteredLibrary = query.trim()
    ? libraryArtists.filter(a =>
        a.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : libraryArtists.slice(0, 12);

  const breadcrumb = view.kind === "artist" ? view.name
    : view.kind === "album" ? (view.artistName ?? "Album")
    : null;

  const prevView = history.length > 1 ? history[history.length - 2] : null;
  const backLabel = prevView?.kind === "artist" ? prevView.name
    : prevView?.kind === "album" ? (prevView.artistName ?? "Album")
    : "Search";

  return (
    <div className="discover">
      <div className="discover__header">
        {view.kind !== "search" && (
          <button className="discover__back" onClick={pop}>
            <ChevronLeft size={18} /> {backLabel}
          </button>
        )}
        {view.kind === "search" ? (
          <div className="discover__search-wrap">
            <Search size={16} className="discover__search-icon" />
            <input
              className="discover__search"
              placeholder={t('discover.search_placeholder')}
              value={query}
              onChange={e => handleQueryChange(e.target.value)}
              autoFocus
            />
            {searching && <Loader2 size={16} className="discover__search-spin" />}
          </div>
        ) : (
          <h2 className="discover__title">{breadcrumb}</h2>
        )}
      </div>

      {searchError && view.kind === "search" && (
        <div className="discover__error">
          <AlertCircle size={16} /> {searchError}
        </div>
      )}

      {view.kind === "search" && (
        <SearchView
          query={query}
          results={results}
          libraryArtists={filteredLibrary}
          libraryIndex={libraryIndex}
          showAllLibrary={!query.trim()}
          onLibrarySuggestion={handleLibrarySuggestion}
          onSearch={handleLibrarySuggestion}
          onArtist={(a: TidalArtist) => push({ kind: "artist", id: a.id, name: a.name })}
          onAlbum={(a: TidalAlbum) => push({ kind: "album", id: a.id, artistName: a.artist?.name ?? a.artists?.[0]?.name })}
        />
      )}

      {view.kind === "artist" && (
        <ArtistView
          artistId={view.id}
          libraryIndex={libraryIndex}
          onAlbum={(a, artistName) => push({ kind: "album", id: a.id, artistName })}
          LoadingSpinner={LoadingSpinner}
          ErrorBox={ErrorBox}
        />
      )}

      {view.kind === "album" && (
        <AlbumView
          albumId={view.id}
          highlightedTrackId={highlightedTrackId}
          onArtist={(a: TidalArtist) => push({ kind: "artist", id: a.id, name: a.name })}
          onShowToast={showToast}
          LoadingSpinner={LoadingSpinner}
          ErrorBox={ErrorBox}
        />
      )}

      {toast && (
        <div key={toast.key} className="discover__toast">{toast.msg}</div>
      )}
    </div>
  );
}
