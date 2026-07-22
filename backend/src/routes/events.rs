use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures::stream::{self, StreamExt};
use std::sync::Arc;
use tokio_stream::wrappers::BroadcastStream;

use crate::jobs::JobStore;
use crate::middleware::AuthUser;

pub async fn handler(
    auth: AuthUser,
    State(store): State<Arc<JobStore>>,
) -> Sse<impl futures::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let user_id = auth.id.clone();
    let rx = store.event_tx.subscribe();

    let uid_filter = user_id.clone();
    let stream = BroadcastStream::new(rx).filter_map(move |msg| {
        let uid = uid_filter.clone();
        async move {
            match msg {
                Ok(event) if event.user_id == uid => {
                    let data = serde_json::to_string(&event).ok()?;
                    Some(Ok(Event::default().data(data)))
                }
                _ => None,
            }
        }
    });

    // Prepend current jobs snapshot (filtered to this user)
    let snapshot: Vec<_> = store
        .jobs
        .iter()
        .filter(|entry| entry.value().user_id == user_id)
        .map(|entry| {
            let job = entry.value();
            let data = serde_json::to_string(&crate::jobs::models::SseEvent {
                job_id: job.id,
                filename: job.filename.clone(),
                status: job.status.clone(),
                message: job.messages.last().cloned(),
                prompt: job.prompt.clone(),
                artist: job.artist.clone(),
                album: job.album.clone(),
                user_id: job.user_id.clone(),
                source: job.source.clone(),
                album_id: job.album_id,
            })
            .unwrap_or_default();
            Ok(Event::default().data(data))
        })
        .collect();

    let combined = stream::iter(snapshot).chain(stream);
    Sse::new(combined).keep_alive(KeepAlive::default())
}
