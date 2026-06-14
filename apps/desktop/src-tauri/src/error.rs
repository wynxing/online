#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("Task join error: {0}")]
    Join(#[from] tokio::task::JoinError),
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API returned an invalid response: {0}")]
    InvalidApiResponse(String),
    #[error("Audio error: {0}")]
    Audio(String),
    #[error("Config error: {0}")]
    Config(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
