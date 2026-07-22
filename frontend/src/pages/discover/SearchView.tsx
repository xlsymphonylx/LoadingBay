import { useState, useEffect } from "react";
import { Music, Library, Disc3, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  LibraryArtist, LibraryAlbum, TidalArtist, TidalAlbum, TidalTrack,
  SearchResults, checkOwned, OwnedBadge, HoverTidalImg, fmtDuration,
} from "./discoverTypes";
import { SimilarArtistsWidget } from "./SimilarArtistsWidget";
import "./SearchView.scss";

type SearchTab = "artists" | "albums" | "eps" | "tracks";

function dedup<T extends { id: number }>(arr: T[]): T[] {
  const seen = new Set<number>();
  return arr.filter(x => seen.has(x.id) ? false : (seen.add(x.id), true));
}

export function SearchView({
  query, results, libraryArtists, libraryIndex, showAllLibrary,
  onLibrarySuggestion, onArtist, onAlbum, onSearch,
}: {
  query: string;
  results: SearchResults | null;
  libraryArtists: LibraryArtist[];
  libraryIndex: LibraryAlbum[];
  showAllLibrary: boolean;
  onLibrarySuggestion: (name: string) => void;
  onArtist: (a: TidalArtist) => void;
  onAlbum: (a: TidalAlbum) => void;
  onSearch?: (query: string) => void;
}) {
  const { t } = useTranslation();
  const tidalArtists = dedup(results?.artists?.items ?? []);
  const allAlbums    = dedup(results?.albums?.items  ?? []);
  const tidalTracks  = results?.tracks?.items  ?? [];
  const tidalAlbums  = allAlbums.filter(a => a.type !== "EP");
  const tidalEps     = allAlbums.filter(a => a.type === "EP");
  const hasResults   = tidalArtists.length > 0 || allAlbums.length > 0 || tidalTracks.length > 0;

  // Auto-select the tab with most results
  const defaultTab: SearchTab = (() => {
    if (!hasResults) return "artists";
    const counts: [SearchTab, number][] = [
      ["artists", tidalArtists.length],
      ["albums",  tidalAlbums.length],
      ["eps",     tidalEps.length],
      ["tracks",  tidalTracks.length],
    ];
    return counts.reduce((a, b) => b[1] > a[1] ? b : a)[0];
  })();

  const [tab, setTab] = useState<SearchTab>(defaultTab);

  // Switch to best tab whenever results change
  useEffect(() => {
    if (hasResults) setTab(defaultTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  return (
    <div className="discover__results">
      {/* Library suggestions */}
      {libraryArtists.length > 0 && (
        <section className="discover__suggestions">
          <h3 className="discover__section-title">
            <Library size={13} />
            {showAllLibrary ? t('discover.your_library') : t('discover.in_your_library')}
          </h3>
          <div className="discover__chips">
            {libraryArtists.map(a => (
              <button
                key={a.name}
                className="discover__chip"
                onClick={() => onLibrarySuggestion(a.name)}
                title={`${a.album_count} album${a.album_count !== 1 ? "s" : ""}`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Recommendations widget — shown below suggestions when on home view */}
      {!query.trim() && !hasResults && (
        <SimilarArtistsWidget onAlbumClick={id => onAlbum({ id, title: "" })} onSearch={onSearch} />
      )}

      {/* Only show the "type to search" hint when there's no library AND no Navidrome connected
          (the recs widget handles the no-Navidrome case with its own message) */}
      {!query.trim() && !hasResults && libraryArtists.length === 0 && (
        <div className="discover__hint">
          <Music size={40} />
          <p>{t('discover.search_hint')}</p>
        </div>
      )}

      {query.trim() && !hasResults && results && (
        <div className="discover__hint"><p>{t('discover.no_results')}</p></div>
      )}

      {hasResults && (
        <>
          {/* Tabs */}
          <div className="discover__tabs">
            {([
              ["artists", t('discover.artists'), tidalArtists.length],
              ["albums",  t('discover.albums'),  tidalAlbums.length],
              ["eps",     t('discover.eps'),    tidalEps.length],
              ["tracks",  t('discover.tracks'),  tidalTracks.length],
            ] as [SearchTab, string, number][]).map(([key, label, count]) => (
              count > 0 && (
                <button
                  key={key}
                  className={`discover__tab${tab === key ? " discover__tab--active" : ""}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  <span className="discover__tab-count">{count}</span>
                </button>
              )
            ))}
          </div>

          {/* Artists tab */}
          {tab === "artists" && (
            <div className="discover__grid">
              {tidalArtists.map(a => (
                <button key={a.id} className="discover-card" onClick={() => onArtist(a)}>
                  <div className="discover-card__art">
                    <HoverTidalImg
                      uuid={a.picture}
                      alt={a.name}
                      fallback={<div className="discover-card__placeholder"><User size={32} /></div>}
                    />
                  </div>
                  <div className="discover-card__info">
                    <span className="discover-card__name">{a.name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Albums tab */}
          {tab === "albums" && (
            <div className="discover__grid">
              {tidalAlbums.map(a => {
                const artistName = a.artist?.name ?? a.artists?.[0]?.name;
                const owned = checkOwned(a.title, artistName, a.numberOfTracks, libraryIndex);
                return (
                  <button key={a.id} className="discover-card" onClick={() => onAlbum(a)}>
                    <div className="discover-card__art">
                      <HoverTidalImg
                        uuid={a.cover}
                        alt={a.title}
                        fallback={<div className="discover-card__placeholder"><Disc3 size={32} /></div>}
                      />
                      <OwnedBadge status={owned} />
                    </div>
                    <div className="discover-card__info">
                      <span className="discover-card__name">{a.title}</span>
                      {artistName && <span className="discover-card__sub">{artistName}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* EPs tab */}
          {tab === "eps" && (
            <div className="discover__grid">
              {tidalEps.map(a => {
                const artistName = a.artist?.name ?? a.artists?.[0]?.name;
                const owned = checkOwned(a.title, artistName, a.numberOfTracks, libraryIndex);
                return (
                  <button key={a.id} className="discover-card" onClick={() => onAlbum(a)}>
                    <div className="discover-card__art">
                      <HoverTidalImg
                        uuid={a.cover}
                        alt={a.title}
                        fallback={<div className="discover-card__placeholder"><Disc3 size={32} /></div>}
                      />
                      <OwnedBadge status={owned} />
                    </div>
                    <div className="discover-card__info">
                      <span className="discover-card__name">{a.title}</span>
                      {artistName && <span className="discover-card__sub">{artistName}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Tracks tab */}
          {tab === "tracks" && (
            <div className="discover__track-list">
              {tidalTracks.map((track: TidalTrack) => {
                const mainArtist = track.artists?.find(a => a.type === "MAIN") ?? track.artists?.[0];
                const albumEntry: TidalAlbum | undefined = track.album
                  ? { id: track.album.id, title: track.album.title, cover: track.album.cover, releaseDate: track.album.releaseDate }
                  : undefined;
                return (
                  <div key={track.id} className="discover__track discover__track--rich">
                    <button
                      className="discover__track-cover"
                      onClick={() => albumEntry && onAlbum(albumEntry)}
                      title={track.album?.title ?? t('discover.open_album')}
                    >
                      <HoverTidalImg
                        uuid={track.album?.cover}
                        alt={track.album?.title ?? track.title}
                        fallback={<div className="discover__track-cover-placeholder"><Disc3 size={20} /></div>}
                      />
                    </button>
                    <div className="discover__track-info">
                      <button
                        className="discover__track-title"
                        onClick={() => albumEntry && onAlbum(albumEntry)}
                      >
                        {track.title}
                      </button>
                      {mainArtist && (
                        <button
                          className="discover__track-artist"
                          onClick={() => mainArtist && onArtist({ id: mainArtist.id, name: mainArtist.name })}
                        >
                          {mainArtist.name}
                        </button>
                      )}
                    </div>
                    {track.duration && <span className="discover__track-dur">{fmtDuration(track.duration)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
