use thiserror::Error;

#[derive(Debug, Error)]
pub enum PrayerError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("data error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    InvalidInput(String),
    #[error("{0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, PrayerError>;
