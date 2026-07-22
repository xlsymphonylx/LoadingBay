use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
};
use futures::TryStreamExt;
use std::{io::Write, sync::Arc};
use uuid::Uuid;

use crate::{
    fs::extractor::is_audio_filename,
    jobs::{models::{JobStatus, Prompt}, JobStore},
    middleware::AuthUser,
};

const MAX_STAGED_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub async fn handler(
    auth: AuthUser,
    State(store): State<Arc<JobStore>>,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<StatusCode, (StatusCode, String)> {
    // Verify job exists and belongs to this user
    let owner = store.jobs.get(&id).map(|j| j.user_id.clone());
    match owner {
        None => return Err((StatusCode::NOT_FOUND, format!("Job {id} not found"))),
        Some(uid) if uid != auth.id => return Err((StatusCode::FORBIDDEN, "Not your job".into())),
        _ => {}
    }

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::BAD_REQUEST, format!("Multipart error: {e}"))
    })? {
        let filename = field.file_name().unwrap_or("unknown").to_string();
        if !is_audio_filename(&filename) {
            continue;
        }

        let mut buf: Vec<u8> = Vec::new();
        let mut bytes_read: u64 = 0;
        let mut stream = field.into_stream();

        while let Some(chunk) = stream.try_next().await.map_err(|e| {
            (StatusCode::BAD_REQUEST, format!("Read error: {e}"))
        })? {
            bytes_read += chunk.len() as u64;
            if bytes_read > MAX_STAGED_BYTES {
                return Err((StatusCode::PAYLOAD_TOO_LARGE, "File exceeds 4 GB".into()));
            }
            buf.write_all(&chunk).ok();
        }

        store.add_staged_file(id, filename, buf);
    }

    // Re-emit updated ReviewTracks prompt so the frontend refreshes the list
    let (base, staged) = store.get_track_lists(id);
    let prompt = Prompt::ReviewTracks { tracks: base, staged_tracks: staged };
    store.emit(id, JobStatus::AwaitingPrompt, None, Some(prompt));

    Ok(StatusCode::OK)
}
