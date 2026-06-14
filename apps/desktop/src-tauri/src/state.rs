use crate::{error::AppResult, pipeline::PipelineManager, storage::Storage};

pub struct AppState {
    pub storage: Storage,
    pub pipeline: PipelineManager,
}

impl AppState {
    pub fn new(app: &tauri::AppHandle) -> AppResult<Self> {
        let storage = Storage::new()?;
        Ok(Self {
            pipeline: PipelineManager::new(app.clone(), storage.clone()),
            storage,
        })
    }
}
