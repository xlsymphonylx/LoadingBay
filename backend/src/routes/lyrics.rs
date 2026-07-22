use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use bollard::{
    exec::{CreateExecOptions, StartExecResults},
    Docker,
};
use futures::StreamExt;
use serde::Serialize;

use crate::{db::Db, middleware::AuthUser};

#[derive(Serialize)]
pub struct LyricsResult {
    pub success: bool,
    pub output: String,
}

/// POST /api/music/:artist/:album/lyrics
pub async fn handler(
    _auth: AuthUser,
    State(db): State<Db>,
    Path((artist, album)): Path<(String, String)>,
) -> impl IntoResponse {
    run_lyrics(db, format!("/music/{artist}/{album}"), Some(artist), Some(album)).await
}

/// POST /api/music/:artist/lyrics
pub async fn artist_handler(
    _auth: AuthUser,
    State(db): State<Db>,
    Path(artist): Path<String>,
) -> impl IntoResponse {
    run_lyrics(db, format!("/music/{artist}"), Some(artist), None).await
}

async fn run_lyrics(db: Db, music_path: String, artist: Option<String>, album: Option<String>) -> impl IntoResponse {
    let query = format!("path:{music_path}");
    let ctx = match (&artist, &album) {
        (Some(ar), Some(al)) => format!("{ar}/{al}"),
        (Some(ar), None) => ar.clone(),
        _ => music_path.clone(),
    };

    crate::db::append_log(&db, "info", "lyrics",
        &format!("lyrics fetch started: {ctx}"),
        None, None, artist.as_deref(), album.as_deref());

    let docker = match Docker::connect_with_unix_defaults() {
        Ok(d) => d,
        Err(e) => {
            let msg = format!("Cannot connect to Docker socket: {e}");
            crate::db::append_log(&db, "error", "lyrics",
                &format!("lyrics fetch failed: {ctx} — {msg}"),
                None, None, artist.as_deref(), album.as_deref());
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(LyricsResult { success: false, output: msg }),
            );
        }
    };

    let exec = match docker
        .create_exec(
            "beets",
            CreateExecOptions {
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                tty: Some(false),
                env: Some(vec!["TERM=dumb", "NO_COLOR=1", "PYTHONUNBUFFERED=1"]),
                cmd: Some(vec!["beet", "lyrics", &query]),
                ..Default::default()
            },
        )
        .await
    {
        Ok(e) => e,
        Err(e) => {
            let msg = format!("Failed to create exec: {e}");
            crate::db::append_log(&db, "error", "lyrics",
                &format!("lyrics fetch failed: {ctx} — {msg}"),
                None, None, artist.as_deref(), album.as_deref());
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(LyricsResult { success: false, output: msg }),
            );
        }
    };

    let mut output = match docker
        .start_exec(&exec.id, None::<bollard::exec::StartExecOptions>)
        .await
    {
        Ok(StartExecResults::Attached { output, .. }) => output,
        Ok(_) => {
            crate::db::append_log(&db, "error", "lyrics",
                &format!("lyrics fetch failed: {ctx} — exec not attached"),
                None, None, artist.as_deref(), album.as_deref());
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(LyricsResult { success: false, output: "Exec not attached".to_string() }),
            );
        }
        Err(e) => {
            let msg = format!("Failed to start exec: {e}");
            crate::db::append_log(&db, "error", "lyrics",
                &format!("lyrics fetch failed: {ctx} — {msg}"),
                None, None, artist.as_deref(), album.as_deref());
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(LyricsResult { success: false, output: msg }),
            );
        }
    };

    let mut buf = String::new();
    while let Some(item) = output.next().await {
        match item {
            Ok(bollard::container::LogOutput::StdOut { message: b }
            | bollard::container::LogOutput::StdErr { message: b }
            | bollard::container::LogOutput::Console { message: b }) => {
                buf.push_str(&String::from_utf8_lossy(&b));
            }
            _ => {}
        }
    }

    let inspect = docker.inspect_exec(&exec.id).await.ok();
    let exit_code = inspect.and_then(|i| i.exit_code).unwrap_or(0);

    if exit_code == 0 {
        crate::db::append_log(&db, "info", "lyrics",
            &format!("lyrics fetch done: {ctx}"),
            None, None, artist.as_deref(), album.as_deref());
    } else {
        crate::db::append_log(&db, "error", "lyrics",
            &format!("lyrics fetch failed: {ctx} — exit {exit_code}\n{}", buf.trim()),
            None, None, artist.as_deref(), album.as_deref());
    }

    (
        StatusCode::OK,
        Json(LyricsResult { success: exit_code == 0, output: buf }),
    )
}
