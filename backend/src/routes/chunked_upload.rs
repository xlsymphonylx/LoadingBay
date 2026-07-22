use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    db::Db,
    jobs::{models::Job, processor, JobStore},
    middleware::AuthUser,
};

use super::upload::{JobSummary, UploadResponse};

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GB

// ── Session metadata ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct SessionMeta {
    user_id: String,
    filename: String,
    total_size: u64,
    total_chunks: usize,
}

fn session_dir(upload_dir: &PathBuf, id: &Uuid) -> PathBuf {
    upload_dir.join("chunks").join(id.to_string())
}

fn chunk_path(dir: &PathBuf, n: usize) -> PathBuf {
    dir.join(format!("{n}.part"))
}

async fn read_meta(dir: &PathBuf) -> Result<SessionMeta, (StatusCode, String)> {
    let path = dir.join("meta.json");
    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "Upload session not found".into()));
    }
    let bytes = tokio::fs::read(&path).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn received_chunks(dir: &PathBuf, total: usize) -> Vec<usize> {
    (0..total).filter(|n| chunk_path(dir, *n).exists()).collect()
}

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InitBody {
    filename: String,
    total_size: u64,
    total_chunks: usize,
}

#[derive(Serialize)]
pub struct InitResponse {
    upload_id: String,
}

#[derive(Serialize)]
pub struct ChunkAck {
    received: Vec<usize>,
}

#[derive(Serialize)]
pub struct UploadStatus {
    filename: String,
    total_chunks: usize,
    total_size: u64,
    received: Vec<usize>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/upload/init
pub async fn init(
    auth: AuthUser,
    State(db): State<Db>,
    State(upload_dir): State<Arc<PathBuf>>,
    Json(body): Json<InitBody>,
) -> Result<Json<InitResponse>, (StatusCode, String)> {
    if !body.filename.ends_with(".zip") {
        return Err((StatusCode::BAD_REQUEST, "Only .zip files are accepted".into()));
    }
    if body.total_size > MAX_FILE_BYTES {
        return Err((StatusCode::BAD_REQUEST, "File exceeds the 4 GB limit".into()));
    }
    if body.total_chunks == 0 {
        return Err((StatusCode::BAD_REQUEST, "total_chunks must be > 0".into()));
    }

    let id = Uuid::new_v4();
    let dir = session_dir(&upload_dir, &id);
    tokio::fs::create_dir_all(&dir).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let meta = SessionMeta {
        user_id: auth.id.clone(),
        filename: body.filename,
        total_size: body.total_size,
        total_chunks: body.total_chunks,
    };
    let json = serde_json::to_vec(&meta)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tokio::fs::write(dir.join("meta.json"), json).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("Chunked upload init: {} ({} chunks)", meta.filename, meta.total_chunks);
    crate::db::append_log(&db, "info", "upload",
        &format!("Chunked upload init: {} ({} chunks)", meta.filename, meta.total_chunks),
        None, Some(&auth.id), None, None);
    Ok(Json(InitResponse { upload_id: id.to_string() }))
}

/// GET /api/upload/:id
pub async fn status(
    auth: AuthUser,
    State(upload_dir): State<Arc<PathBuf>>,
    Path(id_str): Path<String>,
) -> Result<Json<UploadStatus>, (StatusCode, String)> {
    let id: Uuid = id_str.parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid upload ID".into()))?;
    let dir = session_dir(&upload_dir, &id);
    let meta = read_meta(&dir).await?;

    if meta.user_id != auth.id {
        return Err((StatusCode::FORBIDDEN, "Not your upload".into()));
    }

    Ok(Json(UploadStatus {
        received: received_chunks(&dir, meta.total_chunks),
        filename: meta.filename,
        total_chunks: meta.total_chunks,
        total_size: meta.total_size,
    }))
}

/// PUT /api/upload/:id/chunk/:n
pub async fn upload_chunk(
    auth: AuthUser,
    State(upload_dir): State<Arc<PathBuf>>,
    Path((id_str, n)): Path<(String, usize)>,
    body: Bytes,
) -> Result<Json<ChunkAck>, (StatusCode, String)> {
    let id: Uuid = id_str.parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid upload ID".into()))?;
    let dir = session_dir(&upload_dir, &id);
    let meta = read_meta(&dir).await?;

    if meta.user_id != auth.id {
        return Err((StatusCode::FORBIDDEN, "Not your upload".into()));
    }
    if n >= meta.total_chunks {
        return Err((StatusCode::BAD_REQUEST,
            format!("Chunk index {n} out of range (total {})", meta.total_chunks)));
    }

    tokio::fs::write(chunk_path(&dir, n), body).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ChunkAck { received: received_chunks(&dir, meta.total_chunks) }))
}

/// POST /api/upload/:id  — assemble chunks → ZIP → import job
pub async fn finalize(
    auth: AuthUser,
    State(store): State<Arc<JobStore>>,
    State(db): State<Db>,
    State(upload_dir): State<Arc<PathBuf>>,
    Path(id_str): Path<String>,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let id: Uuid = id_str.parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid upload ID".into()))?;
    let dir = session_dir(&upload_dir, &id);
    let meta = read_meta(&dir).await?;

    if meta.user_id != auth.id {
        return Err((StatusCode::FORBIDDEN, "Not your upload".into()));
    }

    let received = received_chunks(&dir, meta.total_chunks);
    if received.len() != meta.total_chunks {
        let missing: Vec<usize> = (0..meta.total_chunks)
            .filter(|n| !received.contains(n))
            .collect();
        return Err((StatusCode::BAD_REQUEST, format!("Missing chunks: {missing:?}")));
    }

    // Create the job immediately and return — the client gets a job ID right
    // away regardless of how long the chunk assembly takes. This avoids
    // Cloudflare 524 timeouts on large uploads where assembly of hundreds of
    // 5MB chunks can take 30-60 s on a spinning disk.
    let job_id = Uuid::new_v4();
    let zip_path = upload_dir.join(format!("{job_id}.zip"));
    let job = Job::new(job_id, meta.filename.clone(), auth.id.clone(), "import");
    store.insert(job);

    crate::db::append_log(&db, "info", "upload",
        &format!("Chunked upload finalizing: {} → job {job_id} ({} chunks)", meta.filename, meta.total_chunks),
        Some(&job_id.to_string()), Some(&auth.id), None, None);

    // Spawn background task: assemble ZIP → run processor.
    // If assembly fails the job is marked Error so the UI shows a clear message.
    let (store_c, db_c, zip_c, dir_c, name_c, uid_c) = (
        store.clone(), db.clone(), zip_path.clone(),
        dir, meta.filename.clone(), auth.id.clone(),
    );
    tokio::spawn(async move {
        use crate::jobs::models::JobStatus;

        // Assemble chunks → single ZIP
        let assemble_result: Result<(), String> = async {
            let mut out = tokio::fs::File::create(&zip_c).await
                .map_err(|e| format!("Failed to create output ZIP: {e}"))?;
            for n in 0..meta.total_chunks {
                let chunk = tokio::fs::read(chunk_path(&dir_c, n)).await
                    .map_err(|e| format!("Failed to read chunk {n}: {e}"))?;
                out.write_all(&chunk).await
                    .map_err(|e| format!("Failed to write chunk {n}: {e}"))?;
            }
            out.flush().await.map_err(|e| format!("Flush failed: {e}"))?;
            Ok(())
        }.await;

        // Always clean up chunk session directory, success or not
        let _ = tokio::fs::remove_dir_all(&dir_c).await;

        match assemble_result {
            Err(e) => {
                // Delete the partial ZIP so it doesn't linger
                let _ = tokio::fs::remove_file(&zip_c).await;
                store_c.emit(job_id, JobStatus::Error, Some(format!("ZIP assembly failed: {e}")), None);
                crate::db::append_log(&db_c, "error", "upload",
                    &format!("ZIP assembly failed for job {job_id}: {e}"),
                    Some(&job_id.to_string()), Some(&uid_c), None, None);
            }
            Ok(()) => {
                tracing::info!("Chunked upload assembled: {} → job {job_id}", name_c);
                processor::run(store_c, db_c, job_id, zip_c, name_c, uid_c).await;
            }
        }
    });

    Ok(Json(UploadResponse {
        jobs: vec![JobSummary {
            id: job_id,
            filename: meta.filename,
            skipped: false,
            skip_reason: None,
        }],
    }))
}
