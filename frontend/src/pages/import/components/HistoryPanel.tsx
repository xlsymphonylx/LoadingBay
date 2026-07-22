import { useEffect, useState } from "react";
import { CheckCircle, Circle, Tag, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import MetadataProviderModal from "../../../components/MetadataProviderModal";
import { apiFetch } from "../../../context/AuthContext";
import "./HistoryPanel.scss";

type ImportRecord = {
  id: string;
  filename: string;
  artist: string;
  album: string;
  imported_at: string;
  beets_tagged: boolean;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function HistoryPanel() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [beetsTarget, setBeetsTarget] = useState<{ artist: string; album: string } | null>(null);

  async function load() {
    try {
      const res = await apiFetch("/api/history");
      setRecords(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading || records.length === 0) return null;

  return (
    <>
      <div className="history">
        <div className="history__header">
          <Clock size={14} />
          {t('import.history')}
        </div>

        <div className="history__list">
          {records.map((r) => (
            <div key={r.id} className="history__item">
              <div className="history__item__status">
                {r.beets_tagged
                  ? <CheckCircle size={14} color="var(--success)" />
                  : <Circle size={14} color="var(--border)" />
                }
              </div>

              <div className="history__item__info">
                <div className="history__item__name">
                  {r.artist}
                  <span className="history__item__name__sep"> — </span>
                  {r.album}
                </div>
                <div className="history__item__meta">
                  {timeAgo(r.imported_at)}
                  {r.beets_tagged && <span className="history__item__meta__tagged">{t('import.beets_tagged').toUpperCase()}</span>}
                </div>
              </div>

              <button
                className={`history__item__tag-btn history__item__tag-btn--${r.beets_tagged ? "tagged" : "untagged"}`}
                onClick={() => setBeetsTarget({ artist: r.artist, album: r.album })}
              >
                <Tag size={11} />
                {r.beets_tagged ? t('import.retag') : t('import.tag')}
              </button>
            </div>
          ))}
        </div>
      </div>

      {beetsTarget && (
        <MetadataProviderModal
          artist={beetsTarget.artist}
          album={beetsTarget.album}
          onClose={() => { setBeetsTarget(null); load(); }}
        />
      )}
    </>
  );
}
