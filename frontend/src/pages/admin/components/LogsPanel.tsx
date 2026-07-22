import { RefreshCw, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LogRecord, COMPONENTS, LEVELS, timeAgo } from "../adminTypes";

type LogsPanelProps = {
  logs: LogRecord[];
  logsTotal: number;
  logsLevel: string;
  logsComponent: string;
  logsLoading: boolean;
  onLevelChange: (level: string) => void;
  onComponentChange: (component: string) => void;
  onRefresh: () => void;
};

export function LogsPanel({
  logs,
  logsTotal,
  logsLevel,
  logsComponent,
  logsLoading,
  onLevelChange,
  onComponentChange,
  onRefresh,
}: LogsPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="admin-page__logs-header">
        <div className="admin-page__logs-filters">
          <select
            className="admin-page__select"
            value={logsLevel}
            onChange={(e) => onLevelChange(e.target.value)}
          >
            <option value="">{t('admin.logs.all_levels')}</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            className="admin-page__select"
            value={logsComponent}
            onChange={(e) => onComponentChange(e.target.value)}
          >
            <option value="">{t('admin.logs.all_components')}</option>
            {COMPONENTS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="admin-page__refresh-btn"
            onClick={onRefresh}
            disabled={logsLoading}
            title={t('admin.logs.refresh')}
          >
            <RefreshCw size={13} className={logsLoading ? "admin-page__spin" : ""} />
          </button>
        </div>
      </div>

      <div className="admin-page__logs-meta">
        {logsTotal > 0 && (
          <span className="admin-page__logs-meta__count">
            {t('admin.logs.showing', { n: logs.length, total: logsTotal })}
          </span>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="admin-page__empty">{logsLoading ? t('admin.logs.loading') : t('admin.logs.empty')}</div>
      ) : (
        <div className="admin-page__logs-table-wrap">
          <table className="admin-page__table admin-page__logs-table">
            <thead>
              <tr>
                <th>{t('admin.logs.time')}</th>
                <th>{t('admin.logs.level')}</th>
                <th>{t('admin.logs.component')}</th>
                <th>{t('admin.logs.message')}</th>
                <th>{t('admin.logs.context')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={`admin-page__log-row admin-page__log-row--${log.level}`}>
                  <td className="admin-page__table__muted admin-page__logs-time">{timeAgo(log.created_at)}</td>
                  <td>
                    <span className={`admin-page__log-badge admin-page__log-badge--${log.level}`}>
                      {log.level === "info"  && <Info size={10} />}
                      {log.level === "warn"  && <AlertTriangle size={10} />}
                      {log.level === "error" && <AlertCircle size={10} />}
                      {log.level}
                    </span>
                  </td>
                  <td className="admin-page__log-component">{log.component}</td>
                  <td className="admin-page__log-message">{log.message}</td>
                  <td className="admin-page__table__muted admin-page__log-context">
                    {log.artist && log.album ? `${log.artist} / ${log.album}` :
                     log.artist ? log.artist :
                     log.job_id ? <span title={log.job_id}>job:{log.job_id.slice(0, 8)}</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
