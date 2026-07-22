use std::path::PathBuf;

use uuid::Uuid;

use crate::fs::extractor::ExtractedContents;

pub struct ImportContext {
    pub job_id: Uuid,
    pub user_id: String,
    pub filename: String,
    pub zip_path: PathBuf,
    pub stem: String,
    pub artist: String,
    pub album: String,
    pub contents: Option<ExtractedContents>,
    pub keep_cd: bool,
    pub track_names: Vec<String>,
    pub album_dir: Option<PathBuf>,
    pub completed: bool,
}

impl ImportContext {
    pub fn new(job_id: Uuid, user_id: String, filename: String, zip_path: PathBuf) -> Self {
        let stem = filename.trim_end_matches(".zip").to_string();
        Self {
            job_id,
            user_id,
            filename,
            zip_path,
            stem,
            artist: String::new(),
            album: String::new(),
            contents: None,
            keep_cd: false,
            track_names: Vec::new(),
            album_dir: None,
            completed: false,
        }
    }

    pub fn log_job_id(&self) -> String {
        self.job_id.to_string()
    }
}
