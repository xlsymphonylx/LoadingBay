use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::jobs::{models::PromptAnswer, JobStore};
use crate::middleware::AuthUser;

pub async fn handler(
    auth: AuthUser,
    State(store): State<Arc<JobStore>>,
    Path(id): Path<Uuid>,
    Json(answer): Json<PromptAnswer>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Verify the job belongs to the requesting user
    let owner = store.jobs.get(&id).map(|j| j.user_id.clone());
    match owner {
        None => return Err((StatusCode::NOT_FOUND, format!("No pending prompt for job {id}"))),
        Some(uid) if uid != auth.id => return Err((StatusCode::FORBIDDEN, "Not your job".into())),
        _ => {}
    }
    if store.answer_prompt(id, answer) {
        Ok(StatusCode::OK)
    } else {
        Err((StatusCode::NOT_FOUND, format!("No pending prompt for job {id}")))
    }
}
