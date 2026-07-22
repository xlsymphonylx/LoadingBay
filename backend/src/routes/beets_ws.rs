use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::mpsc;

use crate::{
    beets::{
        executor::{run_import, BeetsAction},
        parser::BeetsFrame,
    },
    db::Db,
    jobs::JobStore,
    middleware::AuthUser,
};

/// Abort the beets session if no user input is received within this window.
/// Protects against beets hanging at a prompt when the user navigates away.
const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60); // 10 minutes

#[derive(Deserialize)]
pub struct BeetsQuery {
    pub artist: String,
    pub album: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum ClientMsg {
    Apply,
    Skip,
    UseAsIs,
    MoreCandidates,
    Select { index: usize },
    EnterId { id: String },
    Abort,
}

impl ClientMsg {
    fn into_action(self) -> BeetsAction {
        match self {
            Self::Apply => BeetsAction::Apply,
            Self::Skip => BeetsAction::Skip,
            Self::UseAsIs => BeetsAction::UseAsIs,
            Self::MoreCandidates => BeetsAction::MoreCandidates,
            Self::Select { index } => BeetsAction::Select(index),
            Self::EnterId { id } => BeetsAction::EnterId(id),
            Self::Abort => BeetsAction::Abort,
        }
    }
}

pub async fn handler(
    _auth: AuthUser,
    State(_store): State<Arc<JobStore>>,
    State(db): State<Db>,
    Query(q): Query<BeetsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let music_path = if q.album.is_empty() {
        format!("/music/{}", q.artist)
    } else {
        format!("/music/{}/{}", q.artist, q.album)
    };
    let force = q.force;
    let artist = q.artist.clone();
    let album = q.album.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, music_path, force, db, artist, album))
}

async fn handle_socket(socket: WebSocket, music_path: String, force: bool, db: Db, artist: String, album: String) {
    crate::db::append_log(&db, "info", "beets",
        &format!("beets session started: {artist}/{album}"),
        None, None, Some(&artist), Some(&album));
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<BeetsFrame>();
    let (action_tx, action_rx) = mpsc::unbounded_channel::<BeetsAction>();

    // Run beets import in a task
    let frame_tx2 = frame_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = run_import(music_path, force, frame_tx2.clone(), action_rx).await {
            frame_tx2.send(BeetsFrame::Error { message: e.to_string() }).ok();
        }
    });

    let (artist_task, album_task) = (artist.clone(), album.clone());
    let db_task = db.clone();

    // Forward beets frames → WebSocket; mark tagged in DB on Done
    tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            match &frame {
                BeetsFrame::Done => {
                    crate::db::mark_beets_tagged(&db_task, &artist_task, &album_task).ok();
                    crate::db::append_log(&db_task, "info", "beets",
                        &format!("beets import done: {artist_task}/{album_task}"),
                        None, None, Some(&artist_task), Some(&album_task));
                }
                BeetsFrame::Error { message } => {
                    crate::db::append_log(&db_task, "error", "beets",
                        &format!("beets error: {artist_task}/{album_task} — {message}"),
                        None, None, Some(&artist_task), Some(&album_task));
                }
                _ => {}
            }
            let json = match serde_json::to_string(&frame) {
                Ok(j) => j,
                Err(_) => continue,
            };
            if ws_tx.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    // Forward WebSocket messages → beets actions.
    // Uses an inactivity timeout: if no message arrives within IDLE_TIMEOUT,
    // we treat the client as gone and abort the beets session.
    loop {
        match tokio::time::timeout(IDLE_TIMEOUT, ws_rx.next()).await {
            Ok(Some(Ok(msg))) => match msg {
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMsg>(&text) {
                        action_tx.send(client_msg.into_action()).ok();
                    }
                }
                Message::Close(_) => break,
                _ => {}
            },
            Ok(Some(Err(_))) | Ok(None) => break, // WS error or closed
            Err(_) => {
                // Idle timeout — abort beets so it doesn't hang in the container
                tracing::warn!("Beets session idle for {IDLE_TIMEOUT:?}, sending abort");
                crate::db::append_log(&db, "warn", "beets",
                    &format!("beets session timed out ({}min idle): {artist}/{album}",
                        IDLE_TIMEOUT.as_secs() / 60),
                    None, None, Some(&artist), Some(&album));
                action_tx.send(BeetsAction::Abort).ok();
                break;
            }
        }
    }

    // Always send Abort when the connection closes for any reason.
    // If beets already finished this is a no-op (action_rx end closes stdin).
    action_tx.send(BeetsAction::Abort).ok();
}

