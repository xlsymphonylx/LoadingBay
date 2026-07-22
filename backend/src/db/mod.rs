use anyhow::Result;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

pub mod users;
pub mod imports;
pub mod quotas;
pub mod navidrome;

pub use users::{
    UserRecord, SessionRecord,
    create_user, get_user_by_username, get_user_by_id, get_user_password_hash,
    list_users, delete_user, set_user_role, set_user_admin, set_user_language,
    set_user_file_review, set_user_password_hash, create_session, get_session, delete_session,
    delete_user_sessions, ensure_admin,
};

pub use imports::{
    ImportRecord,
    insert_import, mark_beets_tagged, list_imports_for_user, list_all_imports,
    get_artist_image_url, set_artist_image_url, get_album_cover_url, set_album_cover_url,
};

pub use quotas::{
    QuotaRecord, QuotaInfo,
    get_quota, check_and_use_quota, add_credits, refund_credit,
    increment_lifetime_deletions, reset_deletion_counter, check_and_use_file_quota,
    refund_file_credit, add_file_credits, reset_file_deletion_counter, list_quotas,
};

pub use navidrome::{
    NavidromeCredentials, DailyMixConfig, DailyMixPlaylist, PlaylistShare, LogRecord,
    get_navidrome_creds, set_navidrome_creds, delete_navidrome_creds,
    get_daily_mix_config, set_daily_mix_config, get_daily_mix_playlists,
    upsert_daily_mix_playlist, delete_daily_mix_playlists,
    create_playlist_share, get_pending_shares_for_user, get_share_by_id, update_share_status,
    append_log, query_logs,
};

pub fn open(path: &str) -> Result<Db> {
    let conn = Connection::open(path)?;
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin    INTEGER NOT NULL DEFAULT 0,
            role        TEXT NOT NULL DEFAULT 'user',
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            expires_at  TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS imports (
            id          TEXT PRIMARY KEY,
            filename    TEXT NOT NULL,
            artist      TEXT NOT NULL,
            album       TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            beets_tagged INTEGER NOT NULL DEFAULT 0,
            user_id     TEXT
        );
        CREATE TABLE IF NOT EXISTS artist_images (
            artist      TEXT PRIMARY KEY,
            image_url   TEXT NOT NULL,
            fetched_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS album_covers (
            artist      TEXT NOT NULL,
            album       TEXT NOT NULL,
            image_url   TEXT NOT NULL,
            fetched_at  TEXT NOT NULL,
            PRIMARY KEY (artist, album)
        );
        CREATE TABLE IF NOT EXISTS logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at  TEXT NOT NULL,
            level       TEXT NOT NULL,
            component   TEXT NOT NULL,
            message     TEXT NOT NULL,
            job_id      TEXT,
            user_id     TEXT,
            artist      TEXT,
            album       TEXT
        );
        CREATE TABLE IF NOT EXISTS download_quotas (
            user_id           TEXT PRIMARY KEY,
            date              TEXT NOT NULL,
            downloads_today   INTEGER NOT NULL DEFAULT 0,
            bonus_credits     INTEGER NOT NULL DEFAULT 0,
            lifetime_deletions INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS navidrome_creds (
            user_id      TEXT PRIMARY KEY,
            nav_username TEXT NOT NULL,
            nav_password TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_mix_config (
            user_id      TEXT PRIMARY KEY,
            mix_count    INTEGER NOT NULL DEFAULT 3,
            auto_refresh INTEGER NOT NULL DEFAULT 0,
            last_generated TEXT
        );
        CREATE TABLE IF NOT EXISTS daily_mix_playlists (
            user_id     TEXT NOT NULL,
            slot        INTEGER NOT NULL,
            playlist_id TEXT NOT NULL,
            mix_name    TEXT NOT NULL,
            genre       TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, slot)
        );
        CREATE TABLE IF NOT EXISTS playlist_shares (
            id          TEXT PRIMARY KEY,
            from_user   TEXT NOT NULL,
            to_user     TEXT NOT NULL,
            playlist_id TEXT NOT NULL,
            playlist_name TEXT NOT NULL,
            song_count  INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TEXT NOT NULL
        );
    ")?;
    // Add user_id column to existing imports tables that predate auth
    conn.execute("ALTER TABLE imports ADD COLUMN user_id TEXT", []).ok();
    // Add lifetime_deletions column to existing download_quotas tables
    conn.execute("ALTER TABLE download_quotas ADD COLUMN lifetime_deletions INTEGER NOT NULL DEFAULT 0", []).ok();
    // Add file deletion quota columns
    conn.execute("ALTER TABLE download_quotas ADD COLUMN file_deletions_today INTEGER NOT NULL DEFAULT 0", []).ok();
    conn.execute("ALTER TABLE download_quotas ADD COLUMN file_bonus_credits INTEGER NOT NULL DEFAULT 0", []).ok();
    // Add role column to existing users tables
    conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'", []).ok();
    // Sync role for existing admins
    conn.execute("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'user'", []).ok();
    // Rename legacy 'viewer' role to 'downloader'
    conn.execute("UPDATE users SET role = 'downloader' WHERE role = 'viewer'", []).ok();
    // Add language column to existing users tables
    conn.execute("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'", []).ok();
    // Add require_file_review column to existing users tables (default ON to preserve current behaviour)
    conn.execute("ALTER TABLE users ADD COLUMN require_file_review INTEGER NOT NULL DEFAULT 1", []).ok();
    Ok(Arc::new(Mutex::new(conn)))
}
