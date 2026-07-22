import { useTranslation } from "react-i18next";

type CreateUserFormProps = {
  newUsername: string;
  newPassword: string;
  newIsAdmin: boolean;
  newLanguage: string;
  newNavUsername: string;
  newNavPassword: string;
  createError: string | null;
  creating: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onIsAdminChange: (v: boolean) => void;
  onLanguageChange: (v: string) => void;
  onNavUsernameChange: (v: string) => void;
  onNavPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function CreateUserForm({
  newUsername,
  newPassword,
  newIsAdmin,
  newLanguage,
  newNavUsername,
  newNavPassword,
  createError,
  creating,
  onUsernameChange,
  onPasswordChange,
  onIsAdminChange,
  onLanguageChange,
  onNavUsernameChange,
  onNavPasswordChange,
  onSubmit,
}: CreateUserFormProps) {
  const { t } = useTranslation();

  return (
    <form className="admin-page__create-form" onSubmit={onSubmit}>
      <h3 className="admin-page__create-form__title">{t('admin.create_user')}</h3>
      <div className="admin-page__create-form__row">
        <input
          className="admin-page__input"
          type="text"
          placeholder={t('admin.username_placeholder')}
          value={newUsername}
          onChange={(e) => onUsernameChange(e.target.value)}
          required
        />
        <input
          className="admin-page__input"
          type="password"
          placeholder={t('admin.password_placeholder')}
          value={newPassword}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
        />
        <label className="admin-page__checkbox-label">
          <input
            type="checkbox"
            checked={newIsAdmin}
            onChange={(e) => onIsAdminChange(e.target.checked)}
          />
          {t('admin.is_admin')}
        </label>
        <select
          className="admin-page__role-select"
          value={newLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
        >
          <option value="en">{t('admin.language.en')}</option>
          <option value="es">{t('admin.language.es')}</option>
        </select>
        <button className="admin-page__create-btn" type="submit" disabled={creating}>
          {creating ? t('admin.creating') : t('admin.create')}
        </button>
      </div>
      <div className="admin-page__create-form__row admin-page__create-form__row--navidrome">
        <span className="admin-page__create-form__navidrome-label">{t('admin.navidrome_creds')}</span>
        <input
          className="admin-page__input"
          type="text"
          placeholder={t('admin.navidrome_username')}
          value={newNavUsername}
          onChange={(e) => onNavUsernameChange(e.target.value)}
        />
        <input
          className="admin-page__input"
          type="password"
          placeholder={t('admin.navidrome_password')}
          value={newNavPassword}
          onChange={(e) => onNavPasswordChange(e.target.value)}
        />
      </div>
      {createError && <div className="admin-page__error">{createError}</div>}
    </form>
  );
}
