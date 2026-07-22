import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Disc3 } from "lucide-react";
import { apiFetch } from "../../context/AuthContext";
import { TidalAlbum, LibraryAlbum, checkOwned, OwnedBadge, LazyTidalImg } from "./discoverTypes";
import "./ArtistView.scss";

type DiscoTab = "albums" | "eps" | "singles";
type DiscoSort = "year-desc" | "year-asc" | "name" | "tracks";

function sortReleases(arr: TidalAlbum[], sort: DiscoSort): TidalAlbum[] {
  return [...arr].sort((a, b) => {
    switch (sort) {
      case "year-asc":  return (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "");
      case "year-desc": return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
      case "name":      return a.title.localeCompare(b.title);
      case "tracks":    return (b.numberOfTracks ?? 0) - (a.numberOfTracks ?? 0);
      default:          return 0;
    }
  });
}

export function ArtistView({
  artistId,
  libraryIndex,
  onAlbum,
  LoadingSpinner,
  ErrorBox,
}: {
  artistId: number;
  libraryIndex: LibraryAlbum[];
  onAlbum: (a: TidalAlbum, artistName: string) => void;
  LoadingSpinner: () => React.ReactElement;
  ErrorBox: (props: { msg: string }) => React.ReactElement;
}) {
  const [artistName, setArtistName] = useState("");
  const [albums, setAlbums] = useState<TidalAlbum[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DiscoTab>("albums");
  const [sort, setSort] = useState<DiscoSort>("year-desc");
  const { t } = useTranslation();

  useEffect(() => {
    (async () => {
      try {
        const [albumsRes, artistRes] = await Promise.all([
          apiFetch(`/api/discover/artist/${artistId}/albums`),
          apiFetch(`/api/discover/artist/${artistId}`),
        ]);
        if (!albumsRes.ok) throw new Error(await albumsRes.text());
        const data = await albumsRes.json();
        const items: TidalAlbum[] = Array.isArray(data) ? data : (data.items ?? []);
        setAlbums(items);
        if (artistRes.ok) {
          const artistData = await artistRes.json();
          const name = artistData?.artist?.name ?? items[0]?.artists?.[0]?.name ?? items[0]?.artist?.name;
          if (name) setArtistName(name);
        } else {
          const name = items[0]?.artists?.[0]?.name ?? items[0]?.artist?.name;
          if (name) setArtistName(name);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBox msg={error} />;
  if (!albums || albums.length === 0) {
    return <div className="discover__hint"><p>No albums found for this artist</p></div>;
  }

  const fullAlbums = albums.filter(a => a.type === "ALBUM" || !a.type);
  const eps        = albums.filter(a => a.type === "EP");
  const singles    = albums.filter(a => a.type === "SINGLE");

  // Auto-select first non-empty tab
  const firstNonEmpty: DiscoTab = eps.length > 0 && fullAlbums.length === 0 ? "eps"
    : singles.length > 0 && fullAlbums.length === 0 && eps.length === 0 ? "singles"
    : "albums";

  const effectiveTab = (() => {
    if (tab === "albums"  && fullAlbums.length > 0) return "albums";
    if (tab === "eps"     && eps.length > 0)        return "eps";
    if (tab === "singles" && singles.length > 0)    return "singles";
    return firstNonEmpty;
  })();

  const rawVisible = effectiveTab === "albums" ? fullAlbums
    : effectiveTab === "eps" ? eps
    : singles;

  // Track sort only applies to albums & EPs (singles are always 1 track)
  const effectiveSort = effectiveTab === "singles" && sort === "tracks" ? "year-desc" : sort;
  const visible = sortReleases(rawVisible, effectiveSort);

  const tabs: [DiscoTab, string, number][] = [
    ["albums",  t('discover.albums'),  fullAlbums.length],
    ["eps",     t('discover.eps'),     eps.length],
    ["singles", t('discover.singles'), singles.length],
  ];

  return (
    <div className="discover__discography">
      <div className="discover__discography-controls">
        <div className="discover__tabs">
          {tabs.filter(([,, count]) => count > 0).map(([key, label, count]) => (
            <button
              key={key}
              className={`discover__tab${effectiveTab === key ? " discover__tab--active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
              <span className="discover__tab-count">{count}</span>
            </button>
          ))}
        </div>
        <select
          className="discover__sort-select"
          value={effectiveSort}
          onChange={e => setSort(e.target.value as DiscoSort)}
        >
          <option value="year-desc">Year ↓</option>
          <option value="year-asc">Year ↑</option>
          <option value="name">Name</option>
          {effectiveTab !== "singles" && <option value="tracks">Track count</option>}
        </select>
      </div>
      <div className="discover__grid discover__grid--padded">
        {visible.map(a => {
          const owned = checkOwned(a.title, artistName, a.numberOfTracks, libraryIndex);
          return (
            <button key={a.id} className="discover-card" onClick={() => onAlbum(a, artistName)}>
              <div className="discover-card__art">
                <LazyTidalImg
                  uuid={a.cover}
                  alt={a.title}
                  fallback={<div className="discover-card__placeholder"><Disc3 size={32} /></div>}
                />
                <OwnedBadge status={owned} />
              </div>
              <div className="discover-card__info">
                <span className="discover-card__name">{a.title}</span>
                {a.releaseDate && <span className="discover-card__sub">{a.releaseDate.slice(0, 4)}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
