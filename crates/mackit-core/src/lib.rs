//! # mackit-core
//!
//! The MacKit image engine. It has no UI or Tauri dependencies so it can be unit
//! tested headlessly and reused by any future tool.
//!
//! * [`adjust`] – rotate/flip, light, color, tone curves, sharpening, vignette
//! * [`background`] – remove / replace / blur the background (Apple Vision subject masks)
//! * [`geometry`] – pure layout maths (fit / canvas / stretch / percent, crop, placement)
//! * [`ops`] – the operation pipeline shared by preview and export
//! * [`watermark`] – logo and text composition
//! * [`codec`] – decoding with limits, encoding to PNG/JPEG/WebP/BMP/TIFF
//! * [`export`] – output naming, conflict handling, atomic writes, verification
//! * [`batch`] – incremental, cancellable multi-file processing
//! * [`scan`] – expanding files/folders into an import list
//! * [`preview`] – cached downscaled sources, previews and thumbnails

pub mod adjust;
pub mod background;
pub mod batch;
pub mod codec;
pub mod collage;
pub mod docscan;
pub mod color;
pub mod error;
pub mod export;
pub mod geometry;
pub mod keying;
pub mod naming;
pub mod ops;
pub mod pixels;
pub mod preview;
pub mod scan;
pub mod segment;
pub mod watermark;

pub use error::{EngineError, ErrorPayload, Result};
