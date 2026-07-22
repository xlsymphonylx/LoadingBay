use std::sync::Arc;

use crate::{db::Db, jobs::JobStore};

use super::{context::ImportContext, stages::ImportStage};

pub struct ImportServices {
    pub db: Db,
    pub store: Arc<JobStore>,
}

pub async fn run(
    ctx: &mut ImportContext,
    services: &ImportServices,
    stages: &[ImportStage],
) -> anyhow::Result<()> {
    for stage in stages {
        if ctx.completed {
            break;
        }
        let started = std::time::Instant::now();
        tracing::info!(
            job_id = %ctx.job_id,
            stage = ?stage,
            "import stage started"
        );
        stage.run(ctx, services).await?;
        tracing::info!(
            job_id = %ctx.job_id,
            stage = ?stage,
            elapsed_ms = started.elapsed().as_millis(),
            "import stage completed"
        );
    }

    Ok(())
}
