import { useState, useEffect } from "react";
import { Disc3, ListMusic } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";
import { apiFetch } from "../../context/AuthContext";
import { LazyTidalImg } from "./discoverTypes";
import "./SimilarArtistsWidget.scss";

type SimilarAlbum = {
  id: number;
  title: string;
  cover: string;
  artists: { id: number; name: string }[];
  releaseDate?: string;
  numberOfItems?: number;
};

type RecEntry = {
  based_on: string;
  similar: SimilarAlbum[];
};

const GENRE_SEEDS = [
  "Hip-Hop", "Rock", "Electronic", "R&B", "Jazz", "Pop", "Metal", "Indie",
];

export function SimilarArtistsWidget({
  onAlbumClick,
  onSearch,
}: {
  onAlbumClick: (id: number) => void;
  onSearch?: (query: string) => void;
}) {
  const { t } = useTranslation();
  const [recs, setRecs] = useState<RecEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [noNav, setNoNav] = useState(false);

  useEffect(() => {
    apiFetch("/api/navidrome/recommendations")
      .then(r => {
        if (r.status === 401) { setNoNav(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((data: RecEntry[] | null) => { setRecs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="discover__recs discover__recs--loading">
      <div className="discover__recs-skeleton" />
    </div>
  );

  // No Navidrome or no listening history → show genre seed chips
  if (noNav || !recs || recs.length === 0) return (
    <div className="discover__recs">
      <div className="discover__recs--empty">
        <ListMusic size={22} />
        <span>
          {noNav
            ? <Trans i18nKey="discover.connect_navidrome"><strong>Playlists</strong></Trans>
            : t('discover.listen_more')
          }
        </span>
      </div>
      {!noNav && onSearch && (
        <div className="discover__recs-genres">
          {GENRE_SEEDS.slice(0, 5).map(g => (
            <button key={g} className="discover__chip" onClick={() => onSearch(g)}>
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {recs.map(entry => (
        <div key={entry.based_on} className="discover__recs">
          <h3 className="discover__recs-heading">
            {t('discover.if_you_like_prefix')} <strong>{entry.based_on}</strong>{t('discover.if_you_like_suffix')}
          </h3>
          <div className="discover__recs-albums">
            {entry.similar.slice(0, 10).map(album => {
              const artistNames = album.artists?.map(a => a.name).join(", ") ?? "";
              return (
                <button
                  key={album.id}
                  className="rec-album"
                  onClick={() => onAlbumClick(album.id)}
                  title={`${album.title} — ${artistNames}`}
                >
                  <div className="rec-album__cover">
                    <LazyTidalImg
                      uuid={album.cover}
                      alt={album.title}
                      fallback={<div className="rec-album__placeholder"><Disc3 size={28} /></div>}
                    />
                  </div>
                  <span className="rec-album__title">{album.title}</span>
                  <span className="rec-album__artist">{artistNames}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
