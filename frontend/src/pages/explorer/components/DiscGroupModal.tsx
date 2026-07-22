import { useState } from "react";
import { X, Plus, Trash2, Loader } from "lucide-react";
import { apiFetch } from "../../../context/AuthContext";
import "./DiscGroupModal.scss";

type TrackEntry = { filename: string; disc?: string; rel_path: string };
type Props = {
  artist: string;
  album: string;
  tracks: TrackEntry[];
  onClose: () => void;
  onApplied: () => void;
};

export default function DiscGroupModal({ artist, album, tracks, onClose, onApplied }: Props) {
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of tracks) init[t.filename] = t.disc ?? "";
    return init;
  });
  const [discs, setDiscs] = useState<string[]>(() => {
    const names = new Set(tracks.map(t => t.disc).filter(Boolean) as string[]);
    return Array.from(names).sort();
  });
  const [newDiscName, setNewDiscName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addDisc() {
    const name = newDiscName.trim();
    if (!name || discs.includes(name)) return;
    setDiscs(prev => [...prev, name].sort());
    setNewDiscName("");
  }

  function removeDisc(name: string) {
    setAssignments(prev => {
      const next = { ...prev };
      for (const [file, disc] of Object.entries(next)) {
        if (disc === name) next[file] = "";
      }
      return next;
    });
    setDiscs(prev => prev.filter(d => d !== name));
  }

  async function handleApply() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        assignments: Object.entries(assignments).map(([file, disc]) => ({
          file,
          disc: disc || null,
        })),
      };
      const res = await apiFetch(
        `/api/music/${encodeURIComponent(artist)}/${encodeURIComponent(album)}/disc-group`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (res.ok) {
        onApplied();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Server error ${res.status}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="disc-modal__overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="disc-modal">
        <div className="disc-modal__header">
          <span className="disc-modal__title">Disc Groups</span>
          <button className="disc-modal__close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="disc-modal__add-disc">
          <input
            className="disc-modal__disc-input"
            placeholder="New disc name (e.g. CD 1)"
            value={newDiscName}
            onChange={e => setNewDiscName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addDisc()}
          />
          <button className="disc-modal__add-btn" onClick={addDisc} disabled={!newDiscName.trim()}>
            <Plus size={13} /> Add Disc
          </button>
        </div>

        {discs.length > 0 && (
          <div className="disc-modal__disc-chips">
            {discs.map(d => (
              <span key={d} className="disc-modal__disc-chip">
                {d}
                <button onClick={() => removeDisc(d)}><Trash2 size={10} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="disc-modal__track-list">
          {tracks.map(track => (
            <div key={track.filename} className="disc-modal__track-row">
              <span className="disc-modal__track-name">{track.filename}</span>
              <select
                className="disc-modal__disc-select"
                value={assignments[track.filename] ?? ""}
                onChange={e => setAssignments(prev => ({ ...prev, [track.filename]: e.target.value }))}
              >
                <option value="">— album root —</option>
                {discs.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          ))}
        </div>

        {error && <div className="disc-modal__error">{error}</div>}

        <div className="disc-modal__footer">
          <button className="disc-modal__cancel" onClick={onClose}>Cancel</button>
          <button className="disc-modal__apply" onClick={handleApply} disabled={saving}>
            {saving ? <Loader size={13} className="disc-modal__spin" /> : null}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
