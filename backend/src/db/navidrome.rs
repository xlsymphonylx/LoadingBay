use anyhow::Result;
use rusqlite::params;
use serde::Serialize;
use chrono::{DateTime, Utc};
use super::Db;

#[derive(Debug, Clone, Serialize)]
pub struct NavidromeCredentials {
    pub nav_username: String,
    pub nav_password: String,
}

#[derive(Debug)]
pub struct DailyMixConfig {
    pub mix_count: i64,
    pub auto_refresh: bool,
    pub last_generated: Option<String>,
}

#[derive(Debug)]
pub struct DailyMixPlaylist {
    pub slot: i64,
    pub playlist_id: String,
    pub mix_name: String,
    pub genre: String,
}

#[derive(Debug)]
pub struct PlaylistShare {
    pub id: String,
    pub from_user: String,
    pub to_user: String,
    pub playlist_id: String,
    pub playlist_name: String,
    pub song_count: i64,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogRecord {
    pub id: i64,
    pub created_at: DateTime<Utc>,
    pub level: String,
    pub component: String,
    pub message: String,
    pub job_id: Option<String>,
    pub user_id: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

pub fn get_navidrome_creds(db: &Db, user_id: &str) -> Result<Option<NavidromeCredentials>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT nav_username, nav_password FROM navidrome_creds WHERE user_id = ?1",
    )?;
    let mut rows = stmt.query(params![user_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(NavidromeCredentials {
            nav_username: row.get(0)?,
            nav_password: row.get(1)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn set_navidrome_creds(db: &Db, user_id: &str, username: &str, password: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO navidrome_creds (user_id, nav_username, nav_password) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO UPDATE SET nav_username = ?2, nav_password = ?3",
        params![user_id, username, password],
    )?;
    Ok(())
}

pub fn delete_navidrome_creds(db: &Db, user_id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM navidrome_creds WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

pub fn get_daily_mix_config(db: &Db, user_id: &str) -> Result<DailyMixConfig> {
    let conn = db.lock().unwrap();
    let result = conn.query_row(
        "SELECT mix_count, auto_refresh, last_generated FROM daily_mix_config WHERE user_id = ?1",
        params![user_id],
        |row| Ok(DailyMixConfig {
            mix_count: row.get(0)?,
            auto_refresh: row.get::<_, i32>(1)? != 0,
            last_generated: row.get(2)?,
        }),
    );
    match result {
        Ok(cfg) => Ok(cfg),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(DailyMixConfig {
            mix_count: 3,
            auto_refresh: false,
            last_generated: None,
        }),
        Err(e) => Err(e.into()),
    }
}

pub fn set_daily_mix_config(db: &Db, user_id: &str, mix_count: i64, auto_refresh: bool, last_generated: Option<&str>) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO daily_mix_config (user_id, mix_count, auto_refresh, last_generated)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET mix_count=excluded.mix_count, auto_refresh=excluded.auto_refresh, last_generated=COALESCE(excluded.last_generated, last_generated)",
        params![user_id, mix_count, auto_refresh as i32, last_generated],
    )?;
    Ok(())
}

pub fn get_daily_mix_playlists(db: &Db, user_id: &str) -> Result<Vec<DailyMixPlaylist>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT slot, playlist_id, mix_name, genre FROM daily_mix_playlists WHERE user_id = ?1 ORDER BY slot"
    )?;
    let rows = stmt.query_map(params![user_id], |row| Ok(DailyMixPlaylist {
        slot: row.get(0)?,
        playlist_id: row.get(1)?,
        mix_name: row.get(2)?,
        genre: row.get(3)?,
    }))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn upsert_daily_mix_playlist(db: &Db, user_id: &str, slot: i64, playlist_id: &str, mix_name: &str, genre: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO daily_mix_playlists (user_id, slot, playlist_id, mix_name, genre)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id, slot) DO UPDATE SET playlist_id=excluded.playlist_id, mix_name=excluded.mix_name, genre=excluded.genre",
        params![user_id, slot, playlist_id, mix_name, genre],
    )?;
    Ok(())
}

pub fn delete_daily_mix_playlists(db: &Db, user_id: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM daily_mix_playlists WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

pub fn create_playlist_share(db: &Db, from_user: &str, to_user: &str, playlist_id: &str, playlist_name: &str, song_count: i64) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO playlist_shares (id, from_user, to_user, playlist_id, playlist_name, song_count, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
        params![id, from_user, to_user, playlist_id, playlist_name, song_count, Utc::now().to_rfc3339()],
    )?;
    Ok(id)
}

pub fn get_pending_shares_for_user(db: &Db, user_id: &str) -> Result<Vec<PlaylistShare>> {
    let conn = db.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, from_user, to_user, playlist_id, playlist_name, song_count, status, created_at
         FROM playlist_shares WHERE to_user = ?1 AND status = 'pending' ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map(params![user_id], |row| Ok(PlaylistShare {
        id: row.get(0)?,
        from_user: row.get(1)?,
        to_user: row.get(2)?,
        playlist_id: row.get(3)?,
        playlist_name: row.get(4)?,
        song_count: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
    }))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_share_by_id(db: &Db, id: &str) -> Result<Option<PlaylistShare>> {
    let conn = db.lock().unwrap();
    let result = conn.query_row(
        "SELECT id, from_user, to_user, playlist_id, playlist_name, song_count, status, created_at
         FROM playlist_shares WHERE id = ?1",
        params![id],
        |row| Ok(PlaylistShare {
            id: row.get(0)?,
            from_user: row.get(1)?,
            to_user: row.get(2)?,
            playlist_id: row.get(3)?,
            playlist_name: row.get(4)?,
            song_count: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
        }),
    );
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn update_share_status(db: &Db, id: &str, status: &str) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute("UPDATE playlist_shares SET status = ?1 WHERE id = ?2", params![status, id])?;
    Ok(())
}

/// Write a structured log entry to the DB and mirror it to the tracing subscriber.
pub fn append_log(
    db: &Db,
    level: &str,
    component: &str,
    message: &str,
    job_id: Option<&str>,
    user_id: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) {
    match level {
        "warn"  => tracing::warn!("[{component}] {message}"),
        "error" => tracing::error!("[{component}] {message}"),
        _       => tracing::info!("[{component}] {message}"),
    }
    let conn = db.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO logs (created_at, level, component, message, job_id, user_id, artist, album) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![Utc::now().to_rfc3339(), level, component, message, job_id, user_id, artist, album],
    );
}

pub fn query_logs(
    db: &Db,
    level: Option<&str>,
    component: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<LogRecord>, i64)> {
    let conn = db.lock().unwrap();
    let records = {
        let mut stmt = conn.prepare(
            "SELECT id, created_at, level, component, message, job_id, user_id, artist, album \
             FROM logs \
             WHERE (level = ?1 OR ?1 IS NULL) AND (component = ?2 OR ?2 IS NULL) \
             ORDER BY id DESC LIMIT ?3 OFFSET ?4",
        )?;
        let rows = stmt.query_map(params![level, component, limit, offset], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })?;
        let mut records = Vec::new();
        for row in rows {
            let (id, ts, lvl, comp, msg, jid, uid, art, alb) = row?;
            let created_at = ts.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now());
            records.push(LogRecord {
                id,
                created_at,
                level: lvl,
                component: comp,
                message: msg,
                job_id: jid,
                user_id: uid,
                artist: art,
                album: alb,
            });
        }
        records
    };
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM logs \
         WHERE (level = ?1 OR ?1 IS NULL) AND (component = ?2 OR ?2 IS NULL)",
        params![level, component],
        |row| row.get(0),
    ).unwrap_or(0);
    Ok((records, total))
}
