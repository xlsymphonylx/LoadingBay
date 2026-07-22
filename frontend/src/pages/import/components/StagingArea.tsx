import { useRef, useState } from "react";
import { UploadCloud, AlertTriangle, X, Music2, FileText, ToggleLeft, ToggleRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StagedFile } from "../../../hooks/useBatchSequencer";
import { MAX_FILE_BYTES, generateId, formatSize } from "../../../utils";
import "./StagingArea.scss";

type SkippedFile = { name: string; reason: string };

type Props = {
  files: StagedFile[];
  onAdd: (files: StagedFile[]) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<StagedFile, "runBeets" | "runLyrics">>) => void;
  onStart: () => void;
};

export default function StagingArea({ files, onAdd, onRemove, onUpdate, onStart }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(dropped: File[]) {
    const newSkipped: SkippedFile[] = [];
    const ok: StagedFile[] = [];
    const existingNames = new Set(files.map((f) => f.file.name));
    for (const f of dropped) {
      if (!f.name.endsWith(".zip")) {
        newSkipped.push({ name: f.name, reason: t('import.not_zip') });
      } else if (f.size > MAX_FILE_BYTES) {
        newSkipped.push({ name: f.name, reason: t('import.too_large') });
      } else if (existingNames.has(f.name)) {
        newSkipped.push({ name: f.name, reason: t('import.already_staged') });
      } else {
        existingNames.add(f.name); // guard against two identical files in one drop
        ok.push({
          id: generateId(),
          file: f,
          runBeets: false,
          runLyrics: false,
          phase: "staged",
        });
      }
    }
    setSkipped(newSkipped);
    if (ok.length) onAdd(ok);
  }

  const allBeets = files.length > 0 && files.every((f) => f.runBeets);
  const allLyrics = files.length > 0 && files.every((f) => f.runLyrics);

  return (
    <div className="staging-area">
      <div
        className={["staging-area__drop", dragging ? "staging-area__drop--dragging" : ""].join(" ")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
      >
        <UploadCloud size={28} color={dragging ? "var(--accent)" : "var(--text-muted)"} />
        <span>{t('import.drop_hint')}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      {skipped.length > 0 && (
        <div className="staging-area__skipped">
          <div className="staging-area__skipped__header">
            <AlertTriangle size={13} />
            {t('import.files_skipped', { count: skipped.length })}
          </div>
          {skipped.map((s, i) => (
            <div key={i} className="staging-area__skipped__item">
              <span className="staging-area__skipped__item__name">{s.name}</span>
              <span className="staging-area__skipped__item__reason">{s.reason}</span>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <>
          <div className="staging-area__list-header">
            <span className="staging-area__list-header__count">
              {t('import.files_staged', { count: files.length })}
            </span>
            <button
              className={["staging-area__toggle-all", allBeets ? "staging-area__toggle-all--on" : ""].join(" ")}
              onClick={() => files.forEach((f) => onUpdate(f.id, { runBeets: !allBeets }))}
              title={t('import.toggle_beets_all')}
            >
              {allBeets ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
              <Music2 size={12} />
              {t('import.beets')} all
            </button>
            <button
              className={["staging-area__toggle-all", allLyrics ? "staging-area__toggle-all--on" : ""].join(" ")}
              onClick={() => files.forEach((f) => onUpdate(f.id, { runLyrics: !allLyrics }))}
              title={t('import.toggle_lyrics_all')}
            >
              {allLyrics ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
              <FileText size={12} />
              {t('import.lyrics')} all
            </button>
          </div>

          <div className="staging-area__list">
            {files.map((f) => (
              <div key={f.id} className="staging-area__item">
                <div className="staging-area__item__info">
                  <span className="staging-area__item__name">{f.file.name}</span>
                  <span className="staging-area__item__size">{formatSize(f.file.size)}</span>
                </div>
                <div className="staging-area__item__controls">
                  <button
                    className={["staging-area__item__toggle", f.runBeets ? "staging-area__item__toggle--on" : ""].join(" ")}
                    onClick={() => onUpdate(f.id, { runBeets: !f.runBeets })}
                    title={t('import.toggle_beets_all')}
                  >
                    {f.runBeets ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                    <Music2 size={11} />
                    {t('import.beets')}
                  </button>
                  <button
                    className={["staging-area__item__toggle", f.runLyrics ? "staging-area__item__toggle--on" : ""].join(" ")}
                    onClick={() => onUpdate(f.id, { runLyrics: !f.runLyrics })}
                    title={t('import.toggle_lyrics_all')}
                  >
                    {f.runLyrics ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                    <FileText size={11} />
                    {t('import.lyrics')}
                  </button>
                  <button
                    className="staging-area__item__remove"
                    onClick={() => onRemove(f.id)}
                    title={t('import.remove')}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button className="staging-area__start-btn" onClick={onStart}>
            {t('import.start_batch', { count: files.length })}
          </button>
        </>
      )}
    </div>
  );
}
