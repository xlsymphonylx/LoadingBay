import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Check,
  AlertCircle,
  Loader,
  FolderPen,
} from "lucide-react";
import type { MetadataCandidate, ProviderResult, ApplyOptions } from "../types/metadataTypes";
import "./scss/MetadataPreview.scss";

type Props = {
  artist: string;
  album: string;
  result: ProviderResult;
  onBack: () => void;
  onClose: () => void;
  onFinished?: (succeeded: boolean) => void;
};

const SOURCE_LABELS: Record<MetadataCandidate["source"], string> = {
  tidal: "TIDAL",
  musicbrainz: "MusicBrainz",
  deezer: "Deezer",
  allmusic: "AllMusic",
};

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? "meta-preview__score-badge--hi" :
    score >= 50 ? "meta-preview__score-badge--mid" :
    "meta-preview__score-badge--lo";
  return <span className={`meta-preview__score-badge ${cls}`}>{score}% match</span>;
}

export default function MetadataPreview({ artist, album, result, onBack, onClose, onFinished }: Props) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [renameFolder, setRenameFolder] = useState(false);

  const candidates = result.candidates;
  const candidate: MetadataCandidate = candidates[activeIndex] ?? candidates[0];

  // Only suggest a rename when the provider name looks genuinely better than the
  // current folder name: it has MORE non-ASCII (accented) characters, or the
  // folder name contains "##" which signals ASCII mangling during import.
  function isImprovement(folderName: string, providerName: string): boolean {
    if (!providerName || folderName === providerName) return false;
    if (/##/.test(folderName)) return true;
    const nonAscii = (s: string) => [...s].filter(c => c.charCodeAt(0) > 127).length;
    return nonAscii(providerName) >= nonAscii(folderName);
  }

  const artistMismatch = isImprovement(artist, candidate.artistName);
  const albumMismatch = isImprovement(album, candidate.albumTitle);
  const hasMismatch = !!(artistMismatch || albumMismatch);

  async function apply(options?: ApplyOptions) {
    setApplying(true);
    setError(null);
    try {
      const renameOptions: ApplyOptions = { ...options };
      if (hasMismatch && renameFolder && !options?.coverOnly) {
        if (artistMismatch) renameOptions.renameArtist = candidate.artistName;
        if (albumMismatch) renameOptions.renameAlbum = candidate.albumTitle;
      }
      await result.apply(activeIndex, renameOptions);
      setDone(true);
      onFinished?.(true);
    } catch (e) {
      setError(String(e));
      onFinished?.(false);
    } finally {
      setApplying(false);
    }
  }

  if (done) {
    return (
      <div className="meta-preview__done">
        <div className="meta-preview__done__icon">
          <Check size={24} color="var(--success)" />
        </div>
        <span className="meta-preview__done__label">{t("metadata.applied_ok")}</span>
        <button
          className="meta-preview__btn meta-preview__btn--primary"
          onClick={onClose}
        >
          {t("metadata.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="meta-preview">
      <div className="meta-preview__main">
        {/* Cover */}
        <div className="meta-preview__cover-col">
          {candidate.coverUrl ? (
            <img
              className="meta-preview__cover"
              src={candidate.coverUrl}
              alt={candidate.albumTitle}
            />
          ) : (
            <div className="meta-preview__cover-placeholder">
              <Disc3 size={48} />
            </div>
          )}

          {/* Multi-candidate nav */}
          {candidates.length > 1 && (
            <div className="meta-preview__nav">
              <button
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex(i => i - 1)}
                aria-label="Previous candidate"
              >
                <ChevronLeft size={14} />
              </button>
              <span>{activeIndex + 1} / {candidates.length}</span>
              <button
                disabled={activeIndex === candidates.length - 1}
                onClick={() => setActiveIndex(i => i + 1)}
                aria-label="Next candidate"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Info + tracks */}
        <div className="meta-preview__info-col">
          <h3 className="meta-preview__album-title">{candidate.albumTitle}</h3>
          <div className="meta-preview__artist-year">
            {candidate.artistName}
            {candidate.year ? ` · ${candidate.year}` : ""}
          </div>

          <div className="meta-preview__badges">
            <span className={`meta-preview__source-badge meta-preview__source-badge--${candidate.source}`}>
              {SOURCE_LABELS[candidate.source]}
            </span>
            {candidate.score !== undefined && <ScoreBadge score={candidate.score} />}
          </div>

          {/* Track list */}
          <div className="meta-preview__tracks">
            {candidate.tracks.length === 0 ? (
              <p className="meta-preview__tracks__empty">{t("metadata.track_list_unavailable")}</p>
            ) : (
              <ol className="meta-preview__tracks__list">
                {candidate.tracks.slice(0, 20).map(t => (
                  <li key={t.pos} className="meta-preview__tracks__item">
                    <span className="meta-preview__tracks__pos">{t.pos}.</span>
                    <span>{t.title}</span>
                  </li>
                ))}
                {candidate.tracks.length > 20 && (
                  <li className="meta-preview__tracks__item" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    {t("metadata.and_n_more", { count: candidate.tracks.length - 20 })}
                  </li>
                )}
              </ol>
            )}
          </div>
        </div>
      </div>

      {/* Folder rename notice */}
      {hasMismatch && (
        <div className="meta-preview__rename">
          <label className="meta-preview__rename__label">
            <input
              type="checkbox"
              checked={renameFolder}
              onChange={e => setRenameFolder(e.target.checked)}
              className="meta-preview__rename__checkbox"
            />
            <FolderPen size={13} />
            <span>{t("metadata.rename_folder")}</span>
          </label>
          <ul className="meta-preview__rename__list">
            {artistMismatch && (
              <li><span className="meta-preview__rename__old">{artist}</span>{" → "}<span className="meta-preview__rename__new">{candidate.artistName}</span></li>
            )}
            {albumMismatch && (
              <li><span className="meta-preview__rename__old">{album}</span>{" → "}<span className="meta-preview__rename__new">{candidate.albumTitle}</span></li>
            )}
          </ul>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="meta-preview__error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="meta-preview__actions">
        <button
          className={`meta-preview__btn meta-preview__btn--primary${applying ? " meta-preview__btn--loading" : ""}`}
          disabled={applying}
          onClick={() => apply()}
        >
          {applying
            ? <Loader size={14} className="meta-preview__spinner" />
            : <Check size={14} />}
          {t("metadata.apply_all")}
        </button>

        <button
          className="meta-preview__btn"
          disabled={applying}
          onClick={() => apply({ tagsOnly: true })}
        >
          {t("metadata.apply_tags")}
        </button>

        <button
          className="meta-preview__btn"
          disabled={applying}
          onClick={() => apply({ coverOnly: true })}
        >
          {t("metadata.apply_cover")}
        </button>

        <button
          className="meta-preview__btn"
          disabled={applying}
          onClick={onBack}
        >
          <ChevronLeft size={14} />
          {t("metadata.back")}
        </button>
      </div>
    </div>
  );
}
