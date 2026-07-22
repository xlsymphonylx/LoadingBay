use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    Json,
};
use futures::TryStreamExt;
use serde::Serialize;
use std::{io::Write, path::PathBuf, sync::Arc};
use uuid::Uuid;

use crate::jobs::{models::Job, processor, JobStore};
use crate::{db, db::Db};
use crate::middleware::AuthUser;

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GB per file

#[derive(Serialize)]
pub struct UploadResponse {
    pub jobs: Vec<JobSummary>,
}

#[derive(Serialize)]
pub struct JobSummary {
    pub id: Uuid,
    pub filename: String,
    pub skipped: bool,
    pub skip_reason: Option<String>,
}

pub async fn handler(
    auth: AuthUser,
    State(store): State<Arc<JobStore>>,
    State(db): State<Db>,
    State(upload_dir): State<Arc<PathBuf>>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let mut jobs = Vec::new();
    std::fs::create_dir_all(&*upload_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Multipart error: {e}"))
    })? {
        let filename = field
            .file_name()
            .unwrap_or("unknown.zip")
            .to_string();

        if !filename.ends_with(".zip") {
            continue;
        }

        let id = Uuid::new_v4();
        let zip_path = upload_dir.join(format!("{id}.zip"));

        // Stream field to disk, enforcing per-file size limit
        let mut file = std::fs::File::create(&zip_path)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let mut bytes_written: u64 = 0;
        let mut over_limit = false;
        let mut stream = field.into_stream();

        while let Some(chunk) = stream.try_next().await.map_err(|e| (StatusCode::BAD_REQUEST, format!("Read error: {e}")))? {
            bytes_written += chunk.len() as u64;
            if bytes_written > MAX_FILE_BYTES {
                over_limit = true;
                break;
            }
            file.write_all(&chunk)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        drop(file);

        if over_limit {
            let _ = std::fs::remove_file(&zip_path);
            let reason = format!("File exceeds the 4 GB limit");
            db::append_log(&db, "warn", "upload",
                &format!("Upload skipped: {filename} — {reason}"),
                None, Some(&auth.id), None, None);
            jobs.push(JobSummary {
                id,
                filename,
                skipped: true,
                skip_reason: Some(reason),
            });
            continue;
        }

        db::append_log(&db, "info", "upload",
            &format!("ZIP received: {filename}"),
            Some(&id.to_string()), Some(&auth.id), None, None);

        let job = Job::new(id, filename.clone(), auth.id.clone(), "import");
        store.insert(job);

        let store_clone = store.clone();
        let db_clone = db.clone();
        let zip_path_clone = zip_path.clone();
        let filename_clone = filename.clone();
        let user_id_clone = auth.id.clone();
        tokio::spawn(async move {
            processor::run(store_clone, db_clone, id, zip_path_clone, filename_clone, user_id_clone).await;
        });

        jobs.push(JobSummary { id, filename, skipped: false, skip_reason: None });
    }

    Ok(Json(UploadResponse { jobs }))
}
