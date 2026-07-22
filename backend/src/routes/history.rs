use axum::{extract::State, http::StatusCode, Json};
use crate::db::{self, Db, ImportRecord};
use crate::middleware::AuthUser;

pub async fn handler(
    auth: AuthUser,
    State(db): State<Db>,
) -> Result<Json<Vec<ImportRecord>>, (StatusCode, String)> {
    db::list_imports_for_user(&db, &auth.id)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}
