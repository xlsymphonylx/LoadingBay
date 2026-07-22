import { ChevronLeft, Tags, Music, RefreshCw, Search, Mic2, Loader, CheckCircle, XCircle, CheckSquare, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

export type LyricsState = "idle" | "running" | "done" | "error";

type ExplorerToolbarProps = {
  selectedArtist: string | null;
  selectMode: boolean;
  selectedAlbums: Set<string>;
  lyricsAll: LyricsState;
  query: string;
  sort: string;
  onGoBack: () => void;
  onFetchAllLyrics: () => void;
  onTagAll: () => void;
  onToggleSelectMode: () => void;
  onClearSelection: () => void;
  onRefreshArtists: () => void;
  onQueryChange: (q: string) => void;
  onSortChange: (s: string) => void;
};

export function ExplorerToolbar({
  selectedArtist,
  selectMode,
  selectedAlbums,
  lyricsAll,
  query,
  sort,
  onGoBack,
  onFetchAllLyrics,
  onTagAll,
  onToggleSelectMode,
  onClearSelection,
  onRefreshArtists,
  onQueryChange,
  onSortChange,
}: ExplorerToolbarProps) {
  const { t } = useTranslation();

  const lyricsAllIcon =
    lyricsAll === "running" ? <Loader size={13} className="explorer__spin" /> :
    lyricsAll === "done"    ? <CheckCircle size={13} /> :
    lyricsAll === "error"   ? <XCircle size={13} /> :
    <Mic2 size={13} />;

  return (
    <>
      <div className="explorer__toolbar">
        {selectedArtist ? (
          <>
            <button className="explorer__back-btn" onClick={onGoBack}>
              <ChevronLeft size={16} />
              {t('explorer.back_to_artists')}
            </button>
            <span className="explorer__breadcrumb">{selectedArtist}</span>

            {selectMode && selectedAlbums.size > 0 && (
              <>
                <span className="explorer__select-count">{t('explorer.selected', { count: selectedAlbums.size })}</span>
                <button className="explorer__clear-btn" onClick={onClearSelection}>
                  {t('explorer.clear')}
                </button>
              </>
            )}

            <div className="explorer__toolbar__spacer" />

            {!selectMode && (
              <>
                <button
                  className={`explorer__lyrics-all-btn explorer__lyrics-all-btn--${lyricsAll}`}
                  onClick={onFetchAllLyrics}
                  disabled={lyricsAll === "running"}
                  title={t('explorer.fetch_lyrics_all')}
                >
                  {lyricsAllIcon}
                  {t('explorer.lyrics_all')}
                </button>
                <button
                  className="explorer__tag-all-btn"
                  onClick={onTagAll}
                >
                  <Tags size={14} />
                  {t('explorer.tag_all')}
                </button>
              </>
            )}

            <button
              className={["explorer__select-btn", selectMode ? "explorer__select-btn--active" : ""].filter(Boolean).join(" ")}
              onClick={onToggleSelectMode}
              title={t('explorer.select')}
            >
              {selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
              {selectMode ? t('explorer.selecting') : t('explorer.select')}
            </button>
          </>
        ) : (
          <>
            <div className="explorer__toolbar__title">
              <Music size={16} />
              {t('explorer.music_library')}
            </div>
            <div className="explorer__toolbar__spacer" />
            <button className="explorer__refresh-btn" onClick={onRefreshArtists}>
              <RefreshCw size={14} />
            </button>
          </>
        )}
      </div>

      <div className="explorer__controls">
        <div className="explorer__search">
          <Search size={14} className="explorer__search__icon" />
          <input
            className="explorer__search__input"
            type="text"
            placeholder={selectedArtist ? t('explorer.filter_albums') : t('explorer.filter_artists')}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
        <select
          className="explorer__sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
        >
          <option value="newest">{t('explorer.sort.latest')}</option>
          <option value="az">{t('explorer.sort.az')}</option>
          <option value="za">{t('explorer.sort.za')}</option>
          {!selectedArtist && <option value="most">{t('explorer.sort.most_albums')}</option>}
          {!selectedArtist && <option value="least">{t('explorer.sort.fewest_albums')}</option>}
        </select>
      </div>
    </>
  );
}
