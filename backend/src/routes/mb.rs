use axum::{extract::Path, http::StatusCode, Json};
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::OnceLock;
use tokio::sync::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};

// ── In-process cache (avoids hammering MB's 1 req/sec limit) ─────────────────

struct CacheEntry {
    data: Value,
    inserted: Instant,
}

static MB_CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();

fn mb_cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    MB_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const TTL: Duration = Duration::from_secs(3600); // 1 hour

// ── Cover Art Archive ─────────────────────────────────────────────────────────

async fn cover_url(client: &Client, mbid: &str) -> Option<String> {
    // HEAD check — avoids downloading the full image just to get the URL
    let url = format!("https://coverartarchive.org/release/{mbid}/front-500");
    let resp = client
        .head(&url)
        .header("User-Agent", "LoadingBay/1.0")
        .send()
        .await
        .ok()?;
    if resp.status().is_success() || resp.status().is_redirection() {
        Some(url)
    } else {
        None
    }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// GET /api/mb/release/:mbid
/// Returns normalised release info: title, artist, year, tracks, coverUrl.
pub async fn get_release(Path(mbid): Path<String>) -> Result<Json<Value>, (StatusCode, String)> {
    // Validate roughly
    if mbid.len() != 36 || !mbid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err((StatusCode::BAD_REQUEST, "invalid MBID format".to_string()));
    }

    // Cache hit
    {
        let cache = mb_cache().lock().await;
        if let Some(entry) = cache.get(&mbid) {
            if entry.inserted.elapsed() < TTL {
                return Ok(Json(entry.data.clone()));
            }
        }
    }

    let client = Client::new();

    // MusicBrainz release with recordings
    let mb_url = format!(
        "https://musicbrainz.org/ws/2/release/{}?inc=recordings&fmt=json",
        mbid
    );
    let resp = client
        .get(&mb_url)
        .header("User-Agent", "LoadingBay/1.0 (self-hosted music manager)")
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("MusicBrainz unreachable: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("MusicBrainz error: {body}"),
        ));
    }

    let raw: Value = resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("MB JSON parse: {e}")))?;

    // Extract fields
    let title = raw["title"].as_str().unwrap_or("").to_string();
    let artist = raw["artist-credit"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|c| c["artist"]["name"].as_str())
        .unwrap_or("")
        .to_string();
    let year = raw["date"].as_str().and_then(|d| d.get(..4)).map(|y| y.to_string());

    // Collect tracks from all media
    let mut tracks: Vec<Value> = Vec::new();
    if let Some(media) = raw["media"].as_array() {
        for medium in media {
            if let Some(track_list) = medium["tracks"].as_array() {
                for t in track_list {
                    let pos = t["position"].as_u64()
                        .or_else(|| t["number"].as_str().and_then(|n| n.parse().ok()))
                        .unwrap_or((tracks.len() + 1) as u64);
                    let t_title = t["recording"]["title"].as_str()
                        .or_else(|| t["title"].as_str())
                        .unwrap_or("")
                        .to_string();
                    tracks.push(json!({ "pos": pos, "title": t_title }));
                }
            }
        }
    }

    // Cover Art Archive (run concurrently with above, no extra latency)
    let cover = cover_url(&client, &mbid).await;

    let result = json!({
        "title":    title,
        "artist":   artist,
        "year":     year,
        "tracks":   tracks,
        "coverUrl": cover,
    });

    // Store in cache
    {
        let mut cache = mb_cache().lock().await;
        cache.insert(mbid.clone(), CacheEntry { data: result.clone(), inserted: Instant::now() });
    }

    Ok(Json(result))
}
