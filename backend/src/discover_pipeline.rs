use std::{io::Write, path::PathBuf, sync::Arc};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::Client;
use serde::Deserialize;
use tokio::process::Command;
use uuid::Uuid;
use zip::write::{SimpleFileOptions, ZipWriter};

use crate::{
    db::{self, Db},
    jobs::{models::JobStatus, processor, JobStore},
    rate::Prio,
    routes::discover::{
        mono_base, parse_disc_suffix, sanitize_name, tidal_cover_url, tidal_source,
    },
};

#[derive(Deserialize)]
struct MonoAlbumWrapper {
    data: MonoAlbum,
}

#[derive(Deserialize)]
struct MonoArtistRef {
    name: String,
}

#[derive(Deserialize)]
struct MonoTrackEntry {
    item: MonoTrack,
}

#[derive(Deserialize)]
pub struct MonoAlbum {
    title: String,
    #[serde(rename = "releaseDate")]
    release_date: Option<String>,
    cover: Option<String>,
    artist: Option<MonoArtistRef>,
    artists: Option<Vec<MonoArtistRef>>,
    items: Option<Vec<MonoTrackEntry>>,
}

#[derive(Deserialize)]
struct MonoTrack {
    id: u64,
    #[serde(rename = "trackNumber")]
    track_number: u32,
    title: String,
    artist: Option<MonoArtistRef>,
    artists: Option<Vec<MonoArtistRef>>,
}

#[derive(Deserialize)]
struct MonoManifestWrapper {
    data: MonoManifest,
}

#[derive(Deserialize)]
struct MonoManifest {
    manifest: String,
}

#[derive(Deserialize)]
struct ManifestContent {
    urls: Vec<String>,
}

pub async fn fetch_album(album_id: u64) -> anyhow::Result<MonoAlbum> {
    let client = Client::new();
    let album_url = format!("{}/album/?id={}", mono_base(), album_id);
    let album = client
        .get(&album_url)
        .header("User-Agent", "LoadingBay/1.0")
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("monochrome unreachable: {e}"))?
        .json::<MonoAlbumWrapper>()
        .await
        .map_err(|e| anyhow::anyhow!("Invalid album response: {e}"))?
        .data;
    Ok(album)
}

pub fn album_artist_name(album: &MonoAlbum) -> String {
    album
        .artist
        .as_ref()
        .or_else(|| album.artists.as_ref().and_then(|v| v.first()))
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "Unknown Artist".to_string())
}

pub fn album_title(album: &MonoAlbum) -> &str {
    &album.title
}

pub fn zip_names(album: &MonoAlbum) -> (String, String) {
    let artist_name = album_artist_name(album);
    let zip_stem = format!(
        "{} - {}",
        sanitize_name(&album.title),
        sanitize_name(&artist_name)
    );
    let zip_filename = format!("{}.zip", zip_stem);
    (zip_stem, zip_filename)
}

struct DiscoverServices {
    store: Arc<JobStore>,
    db: Db,
    client: Client,
    base: String,
}

struct DiscoverContext {
    job_id: Uuid,
    user_id: String,
    album: Option<MonoAlbum>,
    zip_stem: String,
    zip_filename: String,
    artist_name: String,
    album_name: String,
    clean_album_name: String,
    disc_number: Option<u32>,
    year: String,
    tracks: Vec<MonoTrack>,
    stage_dir: PathBuf,
    cover_path: PathBuf,
    flac_paths: Vec<(u32, PathBuf)>,
    zip_path: PathBuf,
}

#[derive(Debug)]
enum DiscoverStage {
    PrepareMetadata,
    PrepareStageDir,
    FetchCover,
    DownloadTracks,
    BuildArchive,
    CleanupStageDir,
    ImportArchive,
}

impl DiscoverStage {
    async fn run(
        &self,
        ctx: &mut DiscoverContext,
        services: &DiscoverServices,
    ) -> anyhow::Result<()> {
        match self {
            Self::PrepareMetadata => prepare_metadata(ctx, services).await,
            Self::PrepareStageDir => prepare_stage_dir(ctx).await,
            Self::FetchCover => fetch_cover(ctx, services).await,
            Self::DownloadTracks => download_tracks(ctx, services).await,
            Self::BuildArchive => build_archive(ctx, services).await,
            Self::CleanupStageDir => cleanup_stage_dir(ctx).await,
            Self::ImportArchive => import_archive(ctx, services).await,
        }
    }
}

async fn run_pipeline(
    ctx: &mut DiscoverContext,
    services: &DiscoverServices,
    stages: &[DiscoverStage],
) -> anyhow::Result<()> {
    for stage in stages {
        let started = std::time::Instant::now();
        tracing::info!(job_id = %ctx.job_id, stage = ?stage, "discover stage started");
        stage.run(ctx, services).await?;
        tracing::info!(
            job_id = %ctx.job_id,
            stage = ?stage,
            elapsed_ms = started.elapsed().as_millis(),
            "discover stage completed"
        );
    }
    Ok(())
}

pub async fn run(
    store: Arc<JobStore>,
    db: Db,
    job_id: Uuid,
    album: MonoAlbum,
    zip_stem: String,
    zip_filename: String,
    upload_dir: Arc<PathBuf>,
    user_id: String,
) -> anyhow::Result<()> {
    let jid = job_id.to_string();
    let stage_dir = upload_dir.join("discover").join(&jid);
    let cover_path = stage_dir.join("cover.jpg");
    let zip_path = upload_dir.join(&zip_filename);
    let services = DiscoverServices {
        store,
        db,
        client: Client::new(),
        base: mono_base(),
    };
    let mut ctx = DiscoverContext {
        job_id,
        user_id,
        album: Some(album),
        zip_stem,
        zip_filename,
        artist_name: String::new(),
        album_name: String::new(),
        clean_album_name: String::new(),
        disc_number: None,
        year: String::new(),
        tracks: Vec::new(),
        stage_dir,
        cover_path,
        flac_paths: Vec::new(),
        zip_path,
    };

    run_pipeline(
        &mut ctx,
        &services,
        &[
            DiscoverStage::PrepareMetadata,
            DiscoverStage::PrepareStageDir,
            DiscoverStage::FetchCover,
            DiscoverStage::DownloadTracks,
            DiscoverStage::BuildArchive,
            DiscoverStage::CleanupStageDir,
            DiscoverStage::ImportArchive,
        ],
    )
    .await
}

async fn prepare_metadata(
    ctx: &mut DiscoverContext,
    services: &DiscoverServices,
) -> anyhow::Result<()> {
    let album = ctx
        .album
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("Discover album metadata missing"))?;
    ctx.artist_name = album_artist_name(album);
    ctx.album_name = album.title.clone();
    let (clean_album_name, disc_number) = parse_disc_suffix(&ctx.album_name);
    ctx.clean_album_name = clean_album_name;
    ctx.disc_number = disc_number;

    if let Some(disc_number) = ctx.disc_number {
        let jid = ctx.job_id.to_string();
        db::append_log(
            &services.db,
            "warn",
            "discover",
            &format!(
                "Multi-disc album detected: '{}' - folder will keep disc suffix; ALBUM tag set to '{}', DISCNUMBER set to {}",
                ctx.album_name, ctx.clean_album_name, disc_number
            ),
            Some(&jid),
            Some(&ctx.user_id),
            Some(&ctx.artist_name),
            Some(&ctx.album_name),
        );
    }

    ctx.year = album
        .release_date
        .as_deref()
        .and_then(|d| d.split('-').next())
        .unwrap_or("")
        .to_string();
    ctx.tracks = album
        .items
        .take()
        .ok_or_else(|| anyhow::anyhow!("Album metadata contained no track list"))?
        .into_iter()
        .map(|e| e.item)
        .collect();

    if ctx.tracks.is_empty() {
        anyhow::bail!("Album has 0 tracks in API response");
    }

    Ok(())
}

async fn prepare_stage_dir(ctx: &mut DiscoverContext) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(&ctx.stage_dir).await?;
    Ok(())
}

async fn fetch_cover(ctx: &mut DiscoverContext, services: &DiscoverServices) -> anyhow::Result<()> {
    let Some(uuid) = ctx.album.as_ref().and_then(|album| album.cover.as_ref()) else {
        return Ok(());
    };

    services.store.emit(
        ctx.job_id,
        JobStatus::Downloading,
        Some("Downloading cover art...".into()),
        None,
    );
    let _permit = tidal_source().acquire(Prio::Image).await;
    let url = tidal_cover_url(uuid, 1280);
    match services
        .client
        .get(&url)
        .header("User-Agent", "LoadingBay/1.0")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            if let Ok(bytes) = r.bytes().await {
                let _ = tokio::fs::write(&ctx.cover_path, &bytes).await;
            }
        }
        _ => {
            let url640 = tidal_cover_url(uuid, 640);
            match services
                .client
                .get(&url640)
                .header("User-Agent", "LoadingBay/1.0")
                .send()
                .await
            {
                Ok(r) if r.status().is_success() => {
                    if let Ok(bytes) = r.bytes().await {
                        let _ = tokio::fs::write(&ctx.cover_path, &bytes).await;
                    }
                }
                e => {
                    let jid = ctx.job_id.to_string();
                    let reason = e
                        .map(|r| r.status().to_string())
                        .unwrap_or_else(|e| e.to_string());
                    db::append_log(
                        &services.db,
                        "warn",
                        "discover",
                        &format!("Cover download failed ({reason}); continuing without cover"),
                        Some(&jid),
                        Some(&ctx.user_id),
                        None,
                        None,
                    );
                }
            }
        }
    }

    Ok(())
}

async fn download_tracks(
    ctx: &mut DiscoverContext,
    services: &DiscoverServices,
) -> anyhow::Result<()> {
    let jid = ctx.job_id.to_string();
    let total = ctx.tracks.len();

    for (i, track) in ctx.tracks.iter().enumerate() {
        let track_num = track.track_number;
        let safe_title = sanitize_name(&track.title);
        let flac_filename = format!("{:02}. {}.flac", track_num, safe_title);
        let flac_path = ctx.stage_dir.join(&flac_filename);

        if flac_path.exists() {
            db::append_log(
                &services.db,
                "info",
                "discover",
                &format!(
                    "Track {}/{} already downloaded, resuming: {}",
                    i + 1,
                    total,
                    track.title
                ),
                Some(&jid),
                Some(&ctx.user_id),
                Some(&ctx.artist_name),
                Some(&ctx.album_name),
            );
            ctx.flac_paths.push((track_num, flac_path));
            continue;
        }

        services.store.emit(
            ctx.job_id,
            JobStatus::Downloading,
            Some(format!(
                "Downloading track {}/{}: {}",
                i + 1,
                total,
                track.title
            )),
            None,
        );

        let flac_bytes = download_track_bytes(
            &services.client,
            &services.base,
            &services.store,
            ctx.job_id,
            track,
            i,
            total,
        )
        .await?;
        tokio::fs::write(&flac_path, &flac_bytes)
            .await
            .map_err(|e| anyhow::anyhow!("FLAC write for track {}: {e}", track.id))?;

        tag_track(
            &services.db,
            &jid,
            &ctx.user_id,
            &ctx.cover_path,
            &flac_path,
            track,
            &ctx.artist_name,
            &ctx.clean_album_name,
            ctx.disc_number,
            &ctx.year,
            total,
        )
        .await;

        db::append_log(
            &services.db,
            "info",
            "discover",
            &format!("Track {}/{} ready: {}", i + 1, total, track.title),
            Some(&jid),
            Some(&ctx.user_id),
            Some(&ctx.artist_name),
            Some(&ctx.album_name),
        );

        ctx.flac_paths.push((track_num, flac_path));
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }

    Ok(())
}

async fn build_archive(
    ctx: &mut DiscoverContext,
    services: &DiscoverServices,
) -> anyhow::Result<()> {
    services.store.emit(
        ctx.job_id,
        JobStatus::Downloading,
        Some("Building archive...".into()),
        None,
    );
    build_zip(
        &ctx.zip_path,
        &ctx.zip_stem,
        &ctx.cover_path,
        &mut ctx.flac_paths,
    )?;

    let jid = ctx.job_id.to_string();
    db::append_log(
        &services.db,
        "info",
        "discover",
        &format!("Archive ready: {}", ctx.zip_filename),
        Some(&jid),
        Some(&ctx.user_id),
        Some(&ctx.artist_name),
        Some(&ctx.album_name),
    );

    Ok(())
}

async fn cleanup_stage_dir(ctx: &mut DiscoverContext) -> anyhow::Result<()> {
    let _ = tokio::fs::remove_dir_all(&ctx.stage_dir).await;
    Ok(())
}

async fn import_archive(
    ctx: &mut DiscoverContext,
    services: &DiscoverServices,
) -> anyhow::Result<()> {
    processor::run(
        services.store.clone(),
        services.db.clone(),
        ctx.job_id,
        ctx.zip_path.clone(),
        ctx.zip_filename.clone(),
        ctx.user_id.clone(),
    )
    .await;
    Ok(())
}

async fn download_track_bytes(
    client: &Client,
    base: &str,
    store: &Arc<JobStore>,
    job_id: Uuid,
    track: &MonoTrack,
    index: usize,
    total: usize,
) -> anyhow::Result<Vec<u8>> {
    let manifest_url = format!("{}/track/?id={}&quality=LOSSLESS", base, track.id);
    let mut last_err = anyhow::anyhow!("no attempts made");

    for attempt in 0u32..3 {
        if attempt > 0 {
            let wait_secs = 3u64 * 3u64.pow(attempt - 1);
            store.emit(
                job_id,
                JobStatus::Downloading,
                Some(format!(
                    "Track {}/{}: retrying in {}s... (attempt {}/3)",
                    index + 1,
                    total,
                    wait_secs,
                    attempt + 1
                )),
                None,
            );
            tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
        }

        let manifest_resp = {
            let _permit = tidal_source().acquire(Prio::Data).await;
            match client
                .get(&manifest_url)
                .header("User-Agent", "LoadingBay/1.0")
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = anyhow::anyhow!("Manifest request for track {}: {e}", track.id);
                    continue;
                }
            }
        };

        if !manifest_resp.status().is_success() {
            let status = manifest_resp.status();
            let body = manifest_resp.text().await.unwrap_or_default();
            if status.as_u16() == 403 || status.as_u16() == 404 {
                anyhow::bail!(
                    "Track downloads are not available on this monochrome instance (HTTP {status}). Set MONOCHROME_API=https://api.monochrome.tf and restart."
                );
            }
            last_err = anyhow::anyhow!("Manifest HTTP {status} for track {}: {body}", track.id);
            continue;
        }

        let raw = match manifest_resp.json::<MonoManifestWrapper>().await {
            Ok(w) => w.data,
            Err(e) => {
                last_err = anyhow::anyhow!("Manifest JSON for track {}: {e}", track.id);
                continue;
            }
        };
        let manifest_bytes = match B64.decode(&raw.manifest) {
            Ok(b) => b,
            Err(e) => {
                last_err = anyhow::anyhow!("Base64 decode for track {}: {e}", track.id);
                continue;
            }
        };
        let manifest: ManifestContent = match serde_json::from_slice(&manifest_bytes) {
            Ok(m) => m,
            Err(e) => {
                last_err = anyhow::anyhow!("Manifest parse for track {}: {e}", track.id);
                continue;
            }
        };
        let cdn_url = match manifest.urls.into_iter().next() {
            Some(u) => u,
            None => {
                last_err = anyhow::anyhow!("No CDN URL in manifest for track {}", track.id);
                continue;
            }
        };
        match client.get(&cdn_url).send().await {
            Ok(r) => match r.bytes().await {
                Ok(b) => return Ok(b.to_vec()),
                Err(e) => last_err = anyhow::anyhow!("FLAC read for track {}: {e}", track.id),
            },
            Err(e) => last_err = anyhow::anyhow!("FLAC download for track {}: {e}", track.id),
        }
    }

    Err(last_err)
}

async fn tag_track(
    db: &Db,
    jid: &str,
    user_id: &str,
    cover_path: &PathBuf,
    flac_path: &PathBuf,
    track: &MonoTrack,
    artist_name: &str,
    clean_album_name: &str,
    disc_number: Option<u32>,
    year: &str,
    total: usize,
) {
    let track_artist = track
        .artists
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| {
            v.iter()
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .or_else(|| track.artist.as_ref().map(|a| a.name.clone()))
        .unwrap_or_else(|| artist_name.to_string());

    let mut cmd = Command::new("metaflac");
    cmd.env("LANG", "C.UTF-8")
        .env("LC_ALL", "C.UTF-8")
        .arg(format!("--set-tag=TITLE={}", track.title))
        .arg(format!("--set-tag=ARTIST={}", track_artist))
        .arg(format!("--set-tag=ALBUMARTIST={}", artist_name))
        .arg(format!("--set-tag=ALBUM={}", clean_album_name))
        .arg(format!("--set-tag=TRACKNUMBER={}", track.track_number))
        .arg(format!("--set-tag=TRACKTOTAL={}", total));
    if let Some(dn) = disc_number {
        cmd.arg(format!("--set-tag=DISCNUMBER={}", dn));
    }
    if !year.is_empty() {
        cmd.arg(format!("--set-tag=DATE={}", year));
    }
    if cover_path.exists() {
        cmd.arg(format!("--import-picture-from={}", cover_path.display()));
    }
    cmd.arg(flac_path);

    if let Err(e) = cmd.status().await {
        db::append_log(
            db,
            "warn",
            "discover",
            &format!(
                "metaflac unavailable for track {} ({}); beets will handle tagging",
                track.track_number, e
            ),
            Some(jid),
            Some(user_id),
            None,
            None,
        );
    }
}

fn build_zip(
    zip_path: &PathBuf,
    zip_stem: &str,
    cover_path: &PathBuf,
    flac_paths: &mut Vec<(u32, PathBuf)>,
) -> anyhow::Result<()> {
    let zip_file = std::fs::File::create(zip_path)
        .map_err(|e| anyhow::anyhow!("Cannot create ZIP file: {e}"))?;
    let mut zip = ZipWriter::new(zip_file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.add_directory(format!("{}/", zip_stem), opts)?;
    if cover_path.exists() {
        zip.start_file(format!("{}/cover.jpg", zip_stem), opts)?;
        zip.write_all(&std::fs::read(cover_path)?)?;
    }

    flac_paths.sort_by_key(|(n, _)| *n);
    for (_, path) in flac_paths {
        let fname = path.file_name().unwrap().to_string_lossy();
        zip.start_file(format!("{}/{}", zip_stem, fname), opts)?;
        zip.write_all(&std::fs::read(path)?)?;
    }
    zip.finish()?;
    Ok(())
}
