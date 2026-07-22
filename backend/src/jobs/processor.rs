use std::{path::PathBuf, sync::Arc};
use uuid::Uuid;

use crate::{
    db::{self, Db},
    import::{
        context::ImportContext,
        pipeline::{self, ImportServices},
        stages::ImportStage,
    },
    jobs::{models::JobStatus, JobStore},
};

pub async fn run(
    store: Arc<JobStore>,
    db: Db,
    job_id: Uuid,
    zip_path: PathBuf,
    filename: String,
    user_id: String,
) {
    if let Err(e) = process(store.clone(), db.clone(), job_id, zip_path, &filename, &user_id).await {
        store.emit(job_id, JobStatus::Error, Some(e.to_string()), None);
        db::append_log(
            &db,
            "error",
            "import",
            &format!("Import failed: {e}"),
            Some(&job_id.to_string()),
            Some(&user_id),
            None,
            None,
        );
    }
}

async fn process(
    store: Arc<JobStore>,
    db: Db,
    job_id: Uuid,
    zip_path: PathBuf,
    filename: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    let mut import_ctx = ImportContext::new(
        job_id,
        user_id.to_string(),
        filename.to_string(),
        zip_path,
    );
    let services = ImportServices {
        db: db.clone(),
        store: store.clone(),
    };
    pipeline::run(
        &mut import_ctx,
        &services,
        &[
            ImportStage::ParseFilename,
            ImportStage::ValidateDestination,
            ImportStage::ExtractZip,
            ImportStage::ReviewTracks,
            ImportStage::MergeStagedFiles,
            ImportStage::CopyFiles,
            ImportStage::NormalizeAlbumArtist,
            ImportStage::Finalize,
            ImportStage::PersistHistory,
            ImportStage::CleanupZip,
        ],
    )
    .await?;

    Ok(())
}
