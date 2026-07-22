import { useEffect, useState, useCallback } from "react";
import { Tag, RefreshCw, CheckCircle, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import MetadataProviderModal from "../../components/MetadataProviderModal";
import { useAuth, apiFetch } from "../../context/AuthContext";
import { AdminUser, ImportRecord, LogRecord, QuotaInfo, timeAgo } from "./adminTypes";
import { UserTable } from "./components/UserTable";
import { CreateUserForm } from "./components/CreateUserForm";
import { LogsPanel } from "./components/LogsPanel";
import "./AdminPage.scss";

export default function AdminPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newLanguage, setNewLanguage] = useState("en");
  const [newNavUsername, setNewNavUsername] = useState("");
  const [newNavPassword, setNewNavPassword] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [beetsTarget, setBeetsTarget] = useState<{ artist: string; album: string } | null>(null);

  // Logs state
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLevel, setLogsLevel] = useState("");
  const [logsComponent, setLogsComponent] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  // Quotas state
  const [quotas, setQuotas] = useState<QuotaInfo[]>([]);
  const [addingCredits, setAddingCredits] = useState<string | null>(null);
  const [resettingDeletions, setResettingDeletions] = useState<string | null>(null);
  const [addingFileCredits, setAddingFileCredits] = useState<string | null>(null);
  const [resettingFileDeletions, setResettingFileDeletions] = useState<string | null>(null);

  async function loadUsers() {
    const res = await apiFetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  }

  async function loadHistory() {
    const res = await apiFetch("/api/admin/history");
    if (res.ok) setHistory(await res.json());
  }

  async function loadQuotas() {
    const res = await apiFetch("/api/admin/quotas");
    if (res.ok) setQuotas(await res.json());
  }

  const loadLogs = useCallback(async (level = logsLevel, component = logsComponent) => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (level) params.set("level", level);
      if (component) params.set("component", component);
      const res = await apiFetch(`/api/admin/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setLogsTotal(data.total);
      }
    } finally {
      setLogsLoading(false);
    }
  }, [logsLevel, logsComponent]);

  useEffect(() => {
    loadUsers();
    loadHistory();
    loadLogs("", "");
    loadQuotas();
  }, []);

  async function handleSetRole(userId: string, role: string) {
    await apiFetch(`/api/admin/users/${userId}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await loadUsers();
  }

  async function handleSetLanguage(userId: string, language: string) {
    await apiFetch(`/api/admin/users/${userId}/language`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language }),
    });
    await loadUsers();
  }

  async function handleSetFileReview(userId: string, require_file_review: boolean) {
    await apiFetch(`/api/admin/users/${userId}/file-review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ require_file_review }),
    });
    await loadUsers();
  }

  async function handleResetPassword(userId: string, password: string) {
    const res = await apiFetch(`/api/admin/users/${userId}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error ?? "Failed to update password");
    }
  }

  async function handleAddCredits(userId: string) {
    const n = parseInt(prompt("How many credits to add?") ?? "0", 10);
    if (!n || n < 1) return;
    setAddingCredits(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: n }),
      });
      await loadQuotas();
    } finally {
      setAddingCredits(null);
    }
  }

  async function handleResetDeletions(userId: string) {
    if (!confirm("Reset this user's album deletion counter and bonus credits to 0?")) return;
    setResettingDeletions(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}/reset-deletions`, { method: "POST" });
      await loadQuotas();
    } finally {
      setResettingDeletions(null);
    }
  }

  async function handleAddFileCredits(userId: string) {
    const n = parseInt(prompt("How many file deletion credits to add?") ?? "0", 10);
    if (!n || n < 1) return;
    setAddingFileCredits(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}/file-credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: n }),
      });
      await loadQuotas();
    } finally {
      setAddingFileCredits(null);
    }
  }

  async function handleResetFileDeletions(userId: string) {
    if (!confirm("Reset this user's file deletion counter and bonus credits to 0?")) return;
    setResettingFileDeletions(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}/reset-file-deletions`, { method: "POST" });
      await loadQuotas();
    } finally {
      setResettingFileDeletions(null);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          is_admin: newIsAdmin,
          language: newLanguage,
          nav_username: newNavUsername || undefined,
          nav_password: newNavPassword || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(body.error ?? "Failed to create user");
        return;
      }
      setNewUsername("");
      setNewPassword("");
      setNewIsAdmin(false);
      setNewLanguage("en");
      setNewNavUsername("");
      setNewNavPassword("");
      await loadUsers();
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteUser(id: string) {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
    await loadUsers();
  }

  const [activeTab, setActiveTab] = useState<"users" | "history" | "logs">("users");
  const [refreshingRecs, setRefreshingRecs] = useState<"idle" | "loading" | "queued">("idle");

  async function handleRefreshRecs() {
    setRefreshingRecs("loading");
    try {
      const r = await apiFetch("/api/admin/refresh-recommendations", { method: "POST" });
      if (r.ok || r.status === 202) {
        setRefreshingRecs("queued");
        setTimeout(() => setRefreshingRecs("idle"), 4000);
      } else {
        setRefreshingRecs("idle");
      }
    } catch {
      setRefreshingRecs("idle");
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__header-actions">
        <button
          className="admin-page__action-btn"
          onClick={handleRefreshRecs}
          disabled={refreshingRecs !== "idle"}
          title={t('admin.refresh_recs')}
        >
          <RefreshCw size={14} className={refreshingRecs === "loading" ? "spin" : ""} />
          {refreshingRecs === "queued" ? t('admin.refresh_recs_queued') : t('admin.refresh_recs')}
        </button>
      </div>
      <div className="admin-page__tabs">
        {([
          ["users",   t('admin.tabs.users')],
          ["history", t('admin.tabs.import_history')],
          ["logs",    t('admin.tabs.system_logs')],
        ] as ["users"|"history"|"logs", string][]).map(([key, label]) => (
          <button
            key={key}
            className={`admin-page__tab${activeTab === key ? " admin-page__tab--active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
            {key === "history" && history.length > 0 && (
              <span className="admin-page__tab-count">{history.length}</span>
            )}
            {key === "logs" && logsTotal > 0 && (
              <span className="admin-page__tab-count">{logsTotal}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "users" && (
        <section className="admin-page__section">
          <div className="admin-page__users">
            <UserTable
              users={users}
              quotas={quotas}
              currentUserId={currentUser?.id}
              addingCredits={addingCredits}
              resettingDeletions={resettingDeletions}
              addingFileCredits={addingFileCredits}
              resettingFileDeletions={resettingFileDeletions}
              onSetRole={handleSetRole}
              onSetLanguage={handleSetLanguage}
              onSetFileReview={handleSetFileReview}
              onResetPassword={handleResetPassword}
              onDeleteUser={handleDeleteUser}
              onAddCredits={handleAddCredits}
              onResetDeletions={handleResetDeletions}
              onAddFileCredits={handleAddFileCredits}
              onResetFileDeletions={handleResetFileDeletions}
            />
            <CreateUserForm
              newUsername={newUsername}
              newPassword={newPassword}
              newIsAdmin={newIsAdmin}
              newLanguage={newLanguage}
              newNavUsername={newNavUsername}
              newNavPassword={newNavPassword}
              createError={createError}
              creating={creating}
              onUsernameChange={setNewUsername}
              onPasswordChange={setNewPassword}
              onIsAdminChange={setNewIsAdmin}
              onLanguageChange={setNewLanguage}
              onNavUsernameChange={setNewNavUsername}
              onNavPasswordChange={setNewNavPassword}
              onSubmit={handleCreateUser}
            />
          </div>
        </section>
      )}

      {activeTab === "history" && (
      <section className="admin-page__section">
        {history.length === 0 ? (
          <div className="admin-page__empty">{t('admin.no_imports')}</div>
        ) : (
          <table className="admin-page__table">
            <thead>
              <tr>
                <th></th>
                <th>{t('admin.artist_album')}</th>
                <th>{t('admin.user')}</th>
                <th>{t('admin.imported')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.beets_tagged
                      ? <CheckCircle size={13} color="var(--success)" />
                      : <Circle size={13} color="var(--border)" />
                    }
                  </td>
                  <td className="admin-page__table__album">
                    <span>{r.artist}</span>
                    <span className="admin-page__table__sep"> — </span>
                    <span>{r.album}</span>
                  </td>
                  <td className="admin-page__table__muted">{r.username ?? "—"}</td>
                  <td className="admin-page__table__muted">{timeAgo(r.imported_at)}</td>
                  <td>
                    <button
                      className="admin-page__tag-btn"
                      onClick={() => setBeetsTarget({ artist: r.artist, album: r.album })}
                    >
                      <Tag size={11} />
                      {r.beets_tagged ? t('admin.retag') : t('admin.tag')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      )}

      {activeTab === "logs" && (
      <section className="admin-page__section">
        <LogsPanel
          logs={logs}
          logsTotal={logsTotal}
          logsLevel={logsLevel}
          logsComponent={logsComponent}
          logsLoading={logsLoading}
          onLevelChange={(level) => { setLogsLevel(level); loadLogs(level, logsComponent); }}
          onComponentChange={(component) => { setLogsComponent(component); loadLogs(logsLevel, component); }}
          onRefresh={() => loadLogs()}
        />
      </section>
      )}

      {beetsTarget && (
        <MetadataProviderModal
          artist={beetsTarget.artist}
          album={beetsTarget.album}
          onClose={() => { setBeetsTarget(null); loadHistory(); }}
        />
      )}
    </div>
  );
}
