use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{db, middleware::AuthUser, AppState};

#[derive(Serialize)]
pub struct UserResponse {
    pub id: String,
    pub username: String,
    pub is_admin: bool,
    pub role: String,
    pub language: String,
    pub require_file_review: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default = "default_language")]
    pub language: String,
    /// Optional Navidrome credentials to set up at account creation
    pub nav_username: Option<String>,
    pub nav_password: Option<String>,
}

fn default_language() -> String { "en".to_string() }

fn require_admin(auth: &AuthUser) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if auth.is_admin {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Forbidden"}))))
    }
}

/// GET /api/admin/users
pub async fn list_users(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<UserResponse>>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    let users = db::list_users(&state.db).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(users.into_iter().map(|u| UserResponse {
        id: u.id,
        username: u.username,
        is_admin: u.is_admin,
        role: u.role,
        language: u.language,
        require_file_review: u.require_file_review,
        created_at: u.created_at,
    }).collect()))
}

/// POST /api/admin/users
pub async fn create_user(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserResponse>), (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;

    // Check for duplicate username
    let existing = db::get_user_by_username(&state.db, &body.username).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, Json(serde_json::json!({"error": "Username already taken"}))));
    }

    let password = body.password.clone();
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(&password, bcrypt::DEFAULT_COST))
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Internal error"}))))?
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Internal error"}))))?;

    let user_id = db::create_user(&state.db, &body.username, &hash, body.is_admin, &body.language).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;

    // Optionally set Navidrome credentials at account creation
    if let (Some(nav_user), Some(nav_pass)) = (&body.nav_username, &body.nav_password) {
        if !nav_user.is_empty() && !nav_pass.is_empty() {
            let _ = db::set_navidrome_creds(&state.db, &user_id, nav_user, nav_pass);
        }
    }

    let user = db::get_user_by_id(&state.db, &user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "User not found after creation"}))))?;

    Ok((StatusCode::CREATED, Json(UserResponse {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin,
        role: user.role,
        language: user.language,
        require_file_review: user.require_file_review,
        created_at: user.created_at,
    })))
}

/// DELETE /api/admin/users/:id
pub async fn delete_user(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;

    if auth.id == id {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Cannot delete your own account"}))));
    }

    // delete_user cascades: sessions + imports + user row
    db::delete_user(&state.db, &id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/admin/history
pub async fn global_history(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<db::ImportRecord>>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    db::list_all_imports(&state.db).map(Json).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })
}

// ── System logs ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LogsQuery {
    pub level: Option<String>,
    pub component: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 { 100 }

#[derive(Serialize)]
pub struct LogsResponse {
    pub logs: Vec<db::LogRecord>,
    pub total: i64,
}

/// GET /api/admin/logs
pub async fn get_logs(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<LogsQuery>,
) -> Result<Json<LogsResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    let limit = q.limit.clamp(1, 500);
    let (logs, total) = db::query_logs(
        &state.db,
        q.level.as_deref().filter(|s| !s.is_empty()),
        q.component.as_deref().filter(|s| !s.is_empty()),
        limit,
        q.offset,
    ).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(LogsResponse { logs, total }))
}

// ─── Quotas ───────────────────────────────────────────────────────────────────

/// GET /api/admin/quotas  — returns quota info for all users
pub async fn list_quotas(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<db::QuotaInfo>>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    db::list_quotas(&state.db).map(Json).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })
}

#[derive(Deserialize)]
pub struct AddCreditsBody {
    pub credits: i64,
}

/// POST /api/admin/users/:id/credits  { credits: N }
pub async fn add_credits(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<AddCreditsBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    let n = body.credits.clamp(1, 100);
    db::add_credits(&state.db, &user_id, n).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"added": n})))
}

/// POST /api/admin/users/:id/reset-deletions
pub async fn reset_deletions(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    db::reset_deletion_counter(&state.db, &user_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"reset": true})))
}

/// POST /api/admin/users/:id/file-credits  { credits: N }
pub async fn add_file_credits(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<AddCreditsBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    let n = body.credits.clamp(1, 100);
    db::add_file_credits(&state.db, &user_id, n).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"added": n})))
}

/// POST /api/admin/users/:id/reset-file-deletions
pub async fn reset_file_deletions(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    db::reset_file_deletion_counter(&state.db, &user_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"reset": true})))
}

#[derive(Deserialize)]
pub struct SetRoleBody {
    pub role: String,
}

/// PATCH /api/admin/users/:id/role  { role: "downloader"|"user"|"admin" }
pub async fn set_role(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<SetRoleBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    let role = body.role.as_str();
    if !matches!(role, "downloader" | "user" | "admin") {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Invalid role"}))));
    }
    db::set_user_role(&state.db, &user_id, role).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"role": role})))
}

#[derive(Deserialize)]
pub struct SetLanguageBody { pub language: String }

/// PATCH /api/admin/users/:id/language  { language: "en"|"es" }
pub async fn set_language(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<SetLanguageBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    let lang = body.language.as_str();
    if !matches!(lang, "en" | "es") {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Invalid language. Use \"en\" or \"es\""}))));
    }
    db::set_user_language(&state.db, &user_id, lang).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"language": lang})))
}

#[derive(Deserialize)]
pub struct SetFileReviewBody {
    pub require_file_review: bool,
}

/// PATCH /api/admin/users/:id/file-review
pub async fn set_file_review(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<SetFileReviewBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;
    db::set_user_file_review(&state.db, &user_id, body.require_file_review).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()})))
    })?;
    Ok(Json(serde_json::json!({"require_file_review": body.require_file_review})))
}

#[derive(Deserialize)]
pub struct SetPasswordBody {
    pub password: String,
}

/// PATCH /api/admin/users/:id/password
pub async fn set_password(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Json(body): Json<SetPasswordBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(&auth)?;

    if body.password.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Password cannot be empty"}))));
    }

    let password = body.password.clone();
    let hash = tokio::task::spawn_blocking(move || bcrypt::hash(&password, bcrypt::DEFAULT_COST))
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Internal error"}))))?
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Internal error"}))))?;

    db::set_user_password_hash(&state.db, &user_id, &hash).map_err(|e| {
        let code = if e.to_string() == "User not found" {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        (code, Json(serde_json::json!({"error": e.to_string()})))
    })?;

    tracing::info!("Admin {} reset password for user {}", auth.username, user_id);

    Ok(Json(serde_json::json!({"ok": true})))
}
