use anyhow::Result;
use rusqlite::params;
use serde::Serialize;
use chrono::Utc;
use super::Db;

#[derive(Debug, Clone, Serialize)]
pub struct QuotaRecord {
    pub user_id:              String,
    pub date:                 String,
    pub downloads_today:      i64,
    pub bonus_credits:        i64,
    pub file_deletions_today: i64,
    pub file_bonus_credits:   i64,
}

#[derive(Debug, Serialize)]
pub struct QuotaInfo {
    pub user_id:              String,
    pub username:             String,
    pub is_admin:             bool,
    pub downloads_today:      i64,
    pub bonus_credits:        i64,
    pub lifetime_imports:     i64,
    pub last_hour_imports:    i64,
    pub lifetime_deletions:   i64,
    pub file_deletions_today: i64,
    pub file_bonus_credits:   i64,
}

fn today_utc() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Returns the current quota row for a user, creating it if absent.
pub fn get_quota(db: &Db, user_id: &str) -> Result<QuotaRecord> {
    let conn = db.lock().unwrap();
    let today = today_utc();
    // Upsert row ensuring it exists
    conn.execute(
        "INSERT INTO download_quotas (user_id, date, downloads_today, bonus_credits, file_deletions_today, file_bonus_credits)
         VALUES (?1, ?2, 0, 0, 0, 0)
         ON CONFLICT(user_id) DO NOTHING",
        params![user_id, today],
    )?;
    // Reset both counters if the stored date is from a previous day
    conn.execute(
        "UPDATE download_quotas SET downloads_today = 0, file_deletions_today = 0, date = ?2
         WHERE user_id = ?1 AND date != ?2",
        params![user_id, today],
    )?;
    let row = conn.query_row(
        "SELECT user_id, date, downloads_today, bonus_credits, file_deletions_today, file_bonus_credits
         FROM download_quotas WHERE user_id = ?1",
        params![user_id],
        |r| Ok(QuotaRecord {
            user_id:              r.get(0)?,
            date:                 r.get(1)?,
            downloads_today:      r.get(2)?,
            bonus_credits:        r.get(3)?,
            file_deletions_today: r.get(4)?,
            file_bonus_credits:   r.get(5)?,
        }),
    )?;
    Ok(row)
}

/// Atomically check quota and consume one slot. Returns Ok(true) if allowed,
/// Ok(false) if the daily limit is reached.
/// base_limit is ignored for admins — callers should skip for admins.
pub fn check_and_use_quota(db: &Db, user_id: &str, base_limit: i64) -> Result<bool> {
    let quota = get_quota(db, user_id)?;
    let allowed = quota.downloads_today < base_limit + quota.bonus_credits;
    if allowed {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE download_quotas SET downloads_today = downloads_today + 1 WHERE user_id = ?1",
            params![user_id],
        )?;
    }
    Ok(allowed)
}

/// Add N bonus credits to a user (admin action).
pub fn add_credits(db: &Db, user_id: &str, n: i64) -> Result<()> {
    // Ensure row exists first
    get_quota(db, user_id)?;
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET bonus_credits = bonus_credits + ?2 WHERE user_id = ?1",
        params![user_id, n],
    )?;
    Ok(())
}

/// Refund one credit when a user deletes an album they downloaded.
pub fn refund_credit(db: &Db, user_id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET downloads_today = MAX(0, downloads_today - 1) WHERE user_id = ?1",
        params![user_id],
    )?;
    Ok(())
}

/// Increment lifetime_deletions after a successful album deletion.
pub fn increment_lifetime_deletions(db: &Db, user_id: &str) -> Result<()> {
    get_quota(db, user_id)?; // ensure row exists
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET lifetime_deletions = lifetime_deletions + 1 WHERE user_id = ?1",
        params![user_id],
    )?;
    Ok(())
}

/// Reset downloads_today AND bonus_credits back to defaults for a user (admin action).
/// This fully resets the album deletion quota (usage → 0, limit → base 5).
pub fn reset_deletion_counter(db: &Db, user_id: &str) -> Result<()> {
    get_quota(db, user_id)?; // ensure row exists
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET downloads_today = 0, bonus_credits = 0 WHERE user_id = ?1",
        params![user_id],
    )?;
    Ok(())
}

/// Atomically check file deletion quota and consume one slot.
/// Returns Ok(true) if allowed, Ok(false) if the daily limit is reached.
pub fn check_and_use_file_quota(db: &Db, user_id: &str, base_limit: i64) -> Result<bool> {
    let quota = get_quota(db, user_id)?;
    let allowed = quota.file_deletions_today < base_limit + quota.file_bonus_credits;
    if allowed {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE download_quotas SET file_deletions_today = file_deletions_today + 1 WHERE user_id = ?1",
            params![user_id],
        )?;
    }
    Ok(allowed)
}

/// Refund one file deletion credit (e.g. if the delete failed).
pub fn refund_file_credit(db: &Db, user_id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET file_deletions_today = MAX(0, file_deletions_today - 1) WHERE user_id = ?1",
        params![user_id],
    )?;
    Ok(())
}

/// Add N bonus file deletion credits to a user (admin action).
pub fn add_file_credits(db: &Db, user_id: &str, n: i64) -> Result<()> {
    get_quota(db, user_id)?;
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET file_bonus_credits = file_bonus_credits + ?2 WHERE user_id = ?1",
        params![user_id, n],
    )?;
    Ok(())
}

/// Reset file_deletions_today AND file_bonus_credits back to defaults (admin action).
pub fn reset_file_deletion_counter(db: &Db, user_id: &str) -> Result<()> {
    get_quota(db, user_id)?;
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE download_quotas SET file_deletions_today = 0, file_bonus_credits = 0 WHERE user_id = ?1",
        params![user_id],
    )?;
    Ok(())
}

/// List all quota rows (joined with users) for the admin dashboard.
pub fn list_quotas(db: &Db) -> Result<Vec<QuotaInfo>> {
    let conn = db.lock().unwrap();
    let today = today_utc();
    let mut stmt = conn.prepare(
        "SELECT u.id, u.username, u.is_admin,
                COALESCE(q.downloads_today, 0),
                COALESCE(q.bonus_credits, 0),
                COALESCE(q.date, ''),
                COALESCE((SELECT COUNT(*) FROM imports WHERE user_id = u.id), 0),
                COALESCE((SELECT COUNT(*) FROM imports WHERE user_id = u.id
                           AND imported_at >= datetime('now', '-1 hour')), 0),
                COALESCE(q.lifetime_deletions, 0),
                COALESCE(q.file_deletions_today, 0),
                COALESCE(q.file_bonus_credits, 0)
         FROM users u
         LEFT JOIN download_quotas q ON q.user_id = u.id
         ORDER BY u.username ASC",
    )?;
    let records = stmt.query_map([], |r| {
        let stored_date: String = r.get(5)?;
        let downloads_today: i64 = if stored_date == today { r.get(3)? } else { 0 };
        let file_deletions_today: i64 = if stored_date == today { r.get(9)? } else { 0 };
        Ok(QuotaInfo {
            user_id:              r.get(0)?,
            username:             r.get(1)?,
            is_admin:             r.get::<_, i32>(2)? != 0,
            downloads_today,
            bonus_credits:        r.get(4)?,
            lifetime_imports:     r.get(6)?,
            last_hour_imports:    r.get(7)?,
            lifetime_deletions:   r.get(8)?,
            file_deletions_today,
            file_bonus_credits:   r.get(10)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(records)
}
