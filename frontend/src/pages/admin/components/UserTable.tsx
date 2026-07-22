import { Fragment, useState } from "react";
import { Trash2, ShieldCheck, User as UserIcon, CheckCircle, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AdminUser, QuotaInfo, timeAgo } from "../adminTypes";

type UserTableProps = {
  users: AdminUser[];
  quotas: QuotaInfo[];
  currentUserId: string | undefined;
  addingCredits: string | null;
  resettingDeletions: string | null;
  addingFileCredits: string | null;
  resettingFileDeletions: string | null;
  onSetRole: (userId: string, role: string) => void;
  onSetLanguage: (userId: string, language: string) => void;
  onSetFileReview: (userId: string, require_file_review: boolean) => void;
  onResetPassword: (userId: string, password: string) => Promise<void>;
  onDeleteUser: (id: string) => void;
  onAddCredits: (userId: string) => void;
  onResetDeletions: (userId: string) => void;
  onAddFileCredits: (userId: string) => void;
  onResetFileDeletions: (userId: string) => void;
};

export function UserTable({
  users,
  quotas,
  currentUserId,
  addingCredits,
  resettingDeletions,
  addingFileCredits,
  resettingFileDeletions,
  onSetRole,
  onSetLanguage,
  onSetFileReview,
  onResetPassword,
  onDeleteUser,
  onAddCredits,
  onResetDeletions,
  onAddFileCredits,
  onResetFileDeletions,
}: UserTableProps) {
  const { t } = useTranslation();
  const [passwordResetUserId, setPasswordResetUserId] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPasswordFor, setSavingPasswordFor] = useState<string | null>(null);

  function beginPasswordReset(userId: string) {
    setPasswordResetUserId(userId);
    setPasswordDraft("");
    setPasswordConfirm("");
    setPasswordError(null);
  }

  function cancelPasswordReset() {
    setPasswordResetUserId(null);
    setPasswordDraft("");
    setPasswordConfirm("");
    setPasswordError(null);
  }

  async function submitPasswordReset(userId: string) {
    if (!passwordDraft.trim()) {
      setPasswordError(t('admin.password_reset.empty'));
      return;
    }
    if (passwordDraft !== passwordConfirm) {
      setPasswordError(t('admin.password_reset.mismatch'));
      return;
    }

    setSavingPasswordFor(userId);
    setPasswordError(null);
    try {
      await onResetPassword(userId, passwordDraft);
      cancelPasswordReset();
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t('admin.password_reset.failed'));
    } finally {
      setSavingPasswordFor(null);
    }
  }

  return (
    <table className="admin-page__table">
      <thead>
        <tr>
          <th>{t('admin.table.username')}</th>
          <th>{t('admin.table.role')}</th>
          <th>{t('admin.table.language')}</th>
          <th>{t('admin.table.file_review')}</th>
          <th>{t('admin.table.created')}</th>
          <th title="Album deletions">{t('admin.table.deletions_today')}</th>
          <th title="Album bonus credits">{t('admin.table.bonus_credits')}</th>
          <th title="File deletions (daily)">{t('admin.table.file_deletions_today')}</th>
          <th title="File bonus credits">{t('admin.table.file_bonus_credits')}</th>
          <th>{t('admin.table.lifetime_deletions')}</th>
          <th>{t('admin.table.last_hour_imports')}</th>
          <th>{t('admin.table.lifetime_imports')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => {
          const quota = quotas.find(q => q.user_id === u.id);
          const showingPasswordReset = passwordResetUserId === u.id;
          return (
            <Fragment key={u.id}>
              <tr className={u.id === currentUserId ? "admin-page__table__row--self" : ""}>
                <td>
                  <span className="admin-page__table__username">
                    <UserIcon size={13} />
                    {u.username}
                    {u.id === currentUserId && <span className="admin-page__you-badge">{t('admin.you')}</span>}
                  </span>
                </td>
                <td>
                  {u.id === currentUserId
                    ? <span className="admin-page__role admin-page__role--admin"><ShieldCheck size={11} />{t('admin.role.admin')}</span>
                    : (
                      <select
                        className="admin-page__role-select"
                        value={u.role ?? (u.is_admin ? "admin" : "user")}
                        onChange={e => onSetRole(u.id, e.target.value)}
                      >
                        <option value="downloader">{t('admin.role.downloader')}</option>
                        <option value="user">{t('admin.role.user')}</option>
                        <option value="admin">{t('admin.role.admin')}</option>
                      </select>
                    )
                  }
                </td>
                <td>
                  {u.id === currentUserId
                    ? <span className="admin-page__table__muted">{t(`admin.language.${u.language ?? 'en'}`)}</span>
                    : (
                      <select
                        className="admin-page__role-select"
                        value={u.language ?? "en"}
                        onChange={e => onSetLanguage(u.id, e.target.value)}
                      >
                        <option value="en">{t('admin.language.en')}</option>
                        <option value="es">{t('admin.language.es')}</option>
                      </select>
                    )
                  }
                </td>
                <td>
                  <button
                    className={`admin-page__toggle${u.require_file_review ? " admin-page__toggle--on" : ""}`}
                    onClick={() => !u.is_admin && onSetFileReview(u.id, !u.require_file_review)}
                    title={u.require_file_review ? t('admin.file_review.on') : t('admin.file_review.off')}
                    disabled={u.is_admin}
                  >
                    {u.require_file_review ? <CheckCircle size={14} /> : <Circle size={14} />}
                  </button>
                </td>
                <td className="admin-page__table__muted">{timeAgo(u.created_at)}</td>
                <td className="admin-page__table__muted">
                  {u.is_admin ? "∞" : (
                    <span className="admin-page__quota-cell">
                      <span>{quota?.downloads_today ?? 0} / {5 + (quota?.bonus_credits ?? 0)}</span>
                      {!u.is_admin && (
                        <button
                          className="admin-page__reset-btn"
                          onClick={() => onResetDeletions(u.id)}
                          disabled={resettingDeletions === u.id}
                          title={t('admin.reset_deletions')}
                        >
                          ↺
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  {!u.is_admin && (
                    <span className="admin-page__quota-cell">
                      <span className="admin-page__table__muted">{quota?.bonus_credits ?? 0}</span>
                      <button
                        className="admin-page__credits-btn"
                        onClick={() => onAddCredits(u.id)}
                        disabled={addingCredits === u.id}
                        title={t('admin.add_credits')}
                      >
                        + credits
                      </button>
                    </span>
                  )}
                </td>
                <td className="admin-page__table__muted">
                  {u.is_admin ? "∞" : (
                    <span className="admin-page__quota-cell">
                      <span>{quota?.file_deletions_today ?? 0} / {10 + (quota?.file_bonus_credits ?? 0)}</span>
                      {!u.is_admin && (
                        <button
                          className="admin-page__reset-btn"
                          onClick={() => onResetFileDeletions(u.id)}
                          disabled={resettingFileDeletions === u.id}
                          title={t('admin.reset_file_deletions')}
                        >
                          ↺
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td>
                  {!u.is_admin && (
                    <span className="admin-page__quota-cell">
                      <span className="admin-page__table__muted">{quota?.file_bonus_credits ?? 0}</span>
                      <button
                        className="admin-page__credits-btn"
                        onClick={() => onAddFileCredits(u.id)}
                        disabled={addingFileCredits === u.id}
                        title={t('admin.add_file_credits')}
                      >
                        + credits
                      </button>
                    </span>
                  )}
                </td>
                <td className="admin-page__table__muted" title="Total albums deleted by this user">
                  {u.is_admin ? "—" : (quota?.lifetime_deletions ?? 0)}
                </td>
                <td className="admin-page__table__muted" title="Imports in the last hour">
                  {quota?.last_hour_imports ?? 0}
                </td>
                <td className="admin-page__table__muted" title="Total lifetime imports">
                  {quota?.lifetime_imports ?? 0}
                </td>
                <td>
                  <div className="admin-page__row-actions">
                    <button
                      className="admin-page__password-btn"
                      onClick={() => showingPasswordReset ? cancelPasswordReset() : beginPasswordReset(u.id)}
                    >
                      {showingPasswordReset ? t('common.cancel') : t('admin.reset_password')}
                    </button>
                    <button
                      className="admin-page__delete-btn"
                      disabled={u.id === currentUserId}
                      onClick={() => onDeleteUser(u.id)}
                      title={u.id === currentUserId ? t('admin.cannot_delete_self') : "Delete user"}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
              {showingPasswordReset && (
                <tr className="admin-page__password-row">
                  <td colSpan={13}>
                    <div className="admin-page__password-form">
                      <div className="admin-page__password-fields">
                        <input
                          className="admin-page__input"
                          type="password"
                          autoComplete="new-password"
                          value={passwordDraft}
                          onChange={(e) => setPasswordDraft(e.target.value)}
                          placeholder={t('admin.password_reset.new_password')}
                        />
                        <input
                          className="admin-page__input"
                          type="password"
                          autoComplete="new-password"
                          value={passwordConfirm}
                          onChange={(e) => setPasswordConfirm(e.target.value)}
                          placeholder={t('admin.password_reset.confirm_password')}
                        />
                      </div>
                      <div className="admin-page__password-actions">
                        <button
                          className="admin-page__create-btn"
                          onClick={() => submitPasswordReset(u.id)}
                          disabled={savingPasswordFor === u.id}
                        >
                          {savingPasswordFor === u.id ? t('admin.password_reset.saving') : t('admin.password_reset.save')}
                        </button>
                        <button
                          className="admin-page__password-btn"
                          onClick={cancelPasswordReset}
                          disabled={savingPasswordFor === u.id}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                      {passwordError && <div className="admin-page__error">{passwordError}</div>}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
