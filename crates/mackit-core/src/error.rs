use serde::Serialize;
use std::path::PathBuf;

/// Every error the engine can produce. `code()` gives a stable identifier the UI
/// uses to decide how to present the problem (e.g. offering "scale down" when an
/// image does not fit a smaller canvas).
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("Invalid settings: {0}")]
    InvalidInput(String),

    #[error(
        "The image ({src_w}×{src_h}) is larger than the {canvas_w}×{canvas_h} canvas. \
         Canvas Resize never crops, so the whole image cannot fit at its original size. \
         Enable \u{201c}Scale image down to fit\u{201d} or choose a canvas of at least {src_w}×{src_h}."
    )]
    DoesNotFit {
        src_w: u32,
        src_h: u32,
        canvas_w: u32,
        canvas_h: u32,
    },

    #[error("{0}")]
    TooLarge(String),

    #[error("Unsupported file format: {0}")]
    UnsupportedFormat(String),

    #[error("Could not decode image: {0}")]
    Decode(String),

    #[error("Could not encode image: {0}")]
    Encode(String),

    #[error("{0}")]
    Io(String),

    #[error("An output file already exists: {}", .0.display())]
    Conflict(PathBuf),

    #[error("Refusing to overwrite the original file {}", .0.display())]
    WouldOverwriteSource(PathBuf),

    #[error("Export verification failed: {0}")]
    Verification(String),

    #[error("Cancelled")]
    Cancelled,

    #[error("{0}")]
    Segmentation(String),
}

impl EngineError {
    pub fn code(&self) -> &'static str {
        match self {
            EngineError::InvalidInput(_) => "invalid_input",
            EngineError::DoesNotFit { .. } => "does_not_fit",
            EngineError::TooLarge(_) => "too_large",
            EngineError::UnsupportedFormat(_) => "unsupported_format",
            EngineError::Decode(_) => "decode",
            EngineError::Encode(_) => "encode",
            EngineError::Io(_) => "io",
            EngineError::Conflict(_) => "conflict",
            EngineError::WouldOverwriteSource(_) => "would_overwrite_source",
            EngineError::Verification(_) => "verification",
            EngineError::Cancelled => "cancelled",
            EngineError::Segmentation(_) => "segmentation",
        }
    }

    pub fn to_payload(&self) -> ErrorPayload {
        let details = match self {
            EngineError::DoesNotFit {
                src_w,
                src_h,
                canvas_w,
                canvas_h,
            } => Some(serde_json_like(&[
                ("srcW", *src_w),
                ("srcH", *src_h),
                ("canvasW", *canvas_w),
                ("canvasH", *canvas_h),
            ])),
            _ => None,
        };
        ErrorPayload {
            code: self.code().to_string(),
            message: self.to_string(),
            details,
        }
    }
}

fn serde_json_like(pairs: &[(&str, u32)]) -> std::collections::BTreeMap<String, u32> {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

/// Serializable error shape sent to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<std::collections::BTreeMap<String, u32>>,
}

impl From<std::io::Error> for EngineError {
    fn from(e: std::io::Error) -> Self {
        EngineError::Io(e.to_string())
    }
}

impl From<image::ImageError> for EngineError {
    fn from(e: image::ImageError) -> Self {
        use image::ImageError as E;
        match e {
            E::Unsupported(u) => EngineError::UnsupportedFormat(u.to_string()),
            E::Limits(l) => {
                EngineError::TooLarge(format!("Image exceeds the configured size limits ({l})"))
            }
            E::IoError(io) => EngineError::Io(io.to_string()),
            E::Encoding(enc) => EngineError::Encode(enc.to_string()),
            other => EngineError::Decode(other.to_string()),
        }
    }
}

pub type Result<T> = std::result::Result<T, EngineError>;
