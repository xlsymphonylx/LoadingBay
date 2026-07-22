use axum::{
    extract::Query,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn am_get(url: &str) -> Result<String, String> {
    let client = Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", UA)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("AllMusic returned {}", resp.status()));
    }

    resp.text().await.map_err(|e| format!("body read failed: {e}"))
}

/// Upgrade cover URL from 400px to 1080px for best quality.
fn upgrade_cover(url: &str) -> String {
    url.replacen("/400/", "/1080/", 1)
        .replacen("/220/", "/1080/", 1)
}

/// Extract all occurrences of `attr="VALUE"` from HTML, returning the value.
fn extract_attr<'a>(html: &'a str, attr: &str) -> Vec<&'a str> {
    let needle = format!("{attr}=\"");
    let mut results = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find(&needle) {
        rest = &rest[start + needle.len()..];
        if let Some(end) = rest.find('"') {
            results.push(&rest[..end]);
            rest = &rest[end + 1..];
        }
    }
    results
}

/// Extract text content between `>` and `<` after a given pattern.
fn extract_text_after<'a>(html: &'a str, pattern: &str) -> Option<&'a str> {
    let start = html.find(pattern)?;
    let after = &html[start + pattern.len()..];
    let gt = after.find('>')?;
    let text_start = gt + 1;
    let lt = after[text_start..].find('<')?;
    let raw = after[text_start..text_start + lt].trim();
    if raw.is_empty() { None } else { Some(raw) }
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AlbumResult {
    pub mwid: String,
    pub title: String,
    pub artist: String,
    pub year: Option<String>,
    #[serde(rename = "coverUrl")]
    pub cover_url: Option<String>,
}

#[derive(Serialize)]
pub struct AlbumDetail {
    pub mwid: String,
    pub title: String,
    pub artist: String,
    pub year: Option<i32>,
    #[serde(rename = "coverUrl")]
    pub cover_url: Option<String>,
    pub tracks: Vec<TrackItem>,
}

#[derive(Serialize)]
pub struct TrackItem {
    pub pos: usize,
    pub title: String,
}

// ── /api/allmusic/search?q= ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: String,
}

pub async fn search(Query(params): Query<SearchParams>) -> impl IntoResponse {
    let url = format!(
        "https://www.allmusic.com/search/albums/{}",
        urlencoding::encode(&params.q)
    );

    let html = match am_get(&url).await {
        Ok(h) => h,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({
                "error": "scraper_broken",
                "message": e,
            }))).into_response();
        }
    };

    let results = parse_search_results(&html);

    if results.is_empty() && !html.contains("class=\"album\"") {
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({
            "error": "scraper_broken",
            "message": "AllMusic search page structure has changed — parser needs updating",
        }))).into_response();
    }

    (StatusCode::OK, Json(serde_json::json!({ "data": results }))).into_response()
}

fn parse_search_results(html: &str) -> Vec<AlbumResult> {
    let mut results = Vec::new();

    // Each album result is wrapped in <section class="..."> containing class="album"
    // Split on <section to process each block
    for block in html.split("<section") {
        if !block.contains("class=\"album\"") {
            continue;
        }

        // Extract mwid from href like /album/slug-mw0001234567
        let mwid = extract_attr(block, "href")
            .into_iter()
            .find(|h| h.contains("/album/") && h.contains("mw"))
            .and_then(|h| {
                let mw_pos = h.rfind("mw")?;
                // mwid is "mw" followed by 10 digits
                let candidate = &h[mw_pos..];
                let end = candidate.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(candidate.len());
                Some(candidate[..end].to_string())
            });

        let Some(mwid) = mwid else { continue };

        // Title: inside class="title" block, the <a> text
        let title = extract_text_after(block, "class=\"title\"")
            .map(|s| html_decode(s.trim()))
            .unwrap_or_else(|| mwid.clone());

        // Artist: inside class="artists" block
        let artist = {
            if let Some(pos) = block.find("class=\"artists\"") {
                extract_text_after(&block[pos..], "<a")
                    .map(|s| html_decode(s.trim()))
                    .unwrap_or_default()
            } else {
                String::new()
            }
        };

        // Year: class="year"
        let year = {
            if let Some(pos) = block.find("class=\"year\"") {
                extract_text_after(&block[pos..], ">")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            }
        };

        // Cover: data-src on an img tag
        let cover_url = extract_attr(block, "data-src")
            .into_iter()
            .find(|u| u.contains("fastly-s3.allmusic.com"))
            .map(|u| upgrade_cover(u));

        results.push(AlbumResult { mwid, title, artist, year, cover_url });

        if results.len() >= 10 {
            break;
        }
    }

    results
}

// ── /api/allmusic/album/:mwid ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct MwidPath {
    pub mwid: String,
}

pub async fn album(
    axum::extract::Path(MwidPath { mwid }): axum::extract::Path<MwidPath>,
) -> impl IntoResponse {
    // Validate mwid format
    if !mwid.starts_with("mw") || mwid.len() < 4 || !mwid[2..].chars().all(|c| c.is_ascii_digit()) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "error": "invalid_mwid",
            "message": "mwid must be in format mwNNNNNNNNNN",
        }))).into_response();
    }

    let url = format!("https://www.allmusic.com/album/{mwid}");
    let html = match am_get(&url).await {
        Ok(h) => h,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({
                "error": "scraper_broken",
                "message": e,
            }))).into_response();
        }
    };

    match parse_album_detail(&html, &mwid) {
        Some(detail) => (StatusCode::OK, Json(serde_json::to_value(detail).unwrap())).into_response(),
        None => (StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({
            "error": "scraper_broken",
            "message": "AllMusic album page structure has changed — could not find MusicAlbum JSON-LD",
        }))).into_response(),
    }
}

fn parse_album_detail(html: &str, mwid: &str) -> Option<AlbumDetail> {
    // Find the JSON-LD script block containing MusicAlbum
    let ld_marker = "\"@type\": \"MusicAlbum\"";
    let script_start = html.find(ld_marker)?;

    // Walk backwards to find the opening <script> tag's JSON start ('{')
    let json_start = html[..script_start].rfind('{')?;
    let json_tail = &html[json_start..];
    let json_end = find_matching_brace(json_tail)?;
    let json_str = &json_tail[..json_end + 1];

    let data: Value = serde_json::from_str(json_str).ok()?;

    let title = data["name"].as_str()?.to_string();
    let artist = data["byArtist"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|a| a["name"].as_str())
        .unwrap_or("")
        .to_string();

    let year = data["datePublished"]
        .as_str()
        .and_then(|d| d.get(..4))
        .and_then(|y| y.parse::<i32>().ok());

    let cover_url = data["image"]
        .as_str()
        .map(|u| upgrade_cover(u));

    let tracks: Vec<TrackItem> = data["tracks"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .enumerate()
                .filter_map(|(i, t)| {
                    let name = t["name"].as_str()?;
                    Some(TrackItem { pos: i + 1, title: name.to_string() })
                })
                .collect()
        })
        .unwrap_or_default();

    if tracks.is_empty() {
        // JSON-LD present but no tracks — still valid (some compilations)
    }

    Some(AlbumDetail {
        mwid: mwid.to_string(),
        title,
        artist,
        year,
        cover_url,
        tracks,
    })
}

/// Find the closing `}` that matches the opening `{` at position 0.
fn find_matching_brace(s: &str) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (i, c) in s.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        match c {
            '\\' if in_string => escape = true,
            '"' => in_string = !in_string,
            '{' if !in_string => depth += 1,
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Minimal HTML entity decoder for display text.
fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}
