//! Decoding and encoding. All decoding goes through `decode_file`, which applies
//! size limits *before* allocating pixel buffers and honours EXIF orientation.

use crate::error::{EngineError, Result};
use crate::geometry::Limits;
use crate::pixels::{flatten, is_opaque, to_rgb};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageReader, RgbaImage};
use serde::{Deserialize, Serialize};
use std::io::{BufReader, Cursor};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ImageFormat {
    Png,
    Jpeg,
    Webp,
    Bmp,
    Tiff,
    Gif,
}

impl ImageFormat {
    pub const DECODABLE: [ImageFormat; 6] = [
        ImageFormat::Png,
        ImageFormat::Jpeg,
        ImageFormat::Webp,
        ImageFormat::Bmp,
        ImageFormat::Tiff,
        ImageFormat::Gif,
    ];

    pub fn from_extension(ext: &str) -> Option<ImageFormat> {
        match ext.to_ascii_lowercase().as_str() {
            "png" => Some(ImageFormat::Png),
            "jpg" | "jpeg" | "jpe" | "jfif" => Some(ImageFormat::Jpeg),
            "webp" => Some(ImageFormat::Webp),
            "bmp" => Some(ImageFormat::Bmp),
            "tif" | "tiff" => Some(ImageFormat::Tiff),
            "gif" => Some(ImageFormat::Gif),
            _ => None,
        }
    }

    pub fn from_path(path: &Path) -> Option<ImageFormat> {
        path.extension()
            .and_then(|e| e.to_str())
            .and_then(Self::from_extension)
    }

    fn from_image_crate(f: image::ImageFormat) -> Option<ImageFormat> {
        Some(match f {
            image::ImageFormat::Png => ImageFormat::Png,
            image::ImageFormat::Jpeg => ImageFormat::Jpeg,
            image::ImageFormat::WebP => ImageFormat::Webp,
            image::ImageFormat::Bmp => ImageFormat::Bmp,
            image::ImageFormat::Tiff => ImageFormat::Tiff,
            image::ImageFormat::Gif => ImageFormat::Gif,
            _ => return None,
        })
    }

    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Webp => "webp",
            ImageFormat::Bmp => "bmp",
            ImageFormat::Tiff => "tiff",
            ImageFormat::Gif => "gif",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ImageFormat::Png => "PNG",
            ImageFormat::Jpeg => "JPEG",
            ImageFormat::Webp => "WebP",
            ImageFormat::Bmp => "BMP",
            ImageFormat::Tiff => "TIFF",
            ImageFormat::Gif => "GIF",
        }
    }

    /// Whether MacKit can write this format.
    pub fn can_encode(self) -> bool {
        !matches!(self, ImageFormat::Gif)
    }

    /// Whether the encoded output keeps an alpha channel.
    pub fn supports_alpha(self) -> bool {
        matches!(
            self,
            ImageFormat::Png | ImageFormat::Webp | ImageFormat::Tiff
        )
    }

    pub fn is_lossy(self) -> bool {
        matches!(self, ImageFormat::Jpeg | ImageFormat::Webp)
    }
}

/// Header information obtained without decoding pixels.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageHeader {
    pub format: ImageFormat,
    /// Display width (after EXIF orientation).
    pub width: u32,
    /// Display height (after EXIF orientation).
    pub height: u32,
}

fn open_reader(path: &Path) -> Result<ImageReader<BufReader<std::fs::File>>> {
    let reader = ImageReader::open(path)
        .map_err(|e| EngineError::Io(format!("{}: {e}", path.display())))?
        .with_guessed_format()
        .map_err(|e| EngineError::Io(e.to_string()))?;
    Ok(reader)
}

fn detect(reader: &ImageReader<BufReader<std::fs::File>>, path: &Path) -> Result<ImageFormat> {
    match reader.format() {
        Some(f) => ImageFormat::from_image_crate(f)
            .ok_or_else(|| EngineError::UnsupportedFormat(format!("{f:?}"))),
        None => Err(EngineError::UnsupportedFormat(
            path.extension()
                .and_then(|e| e.to_str())
                .map(|e| format!(".{e}"))
                .unwrap_or_else(|| "unknown".into()),
        )),
    }
}

fn swaps_axes(o: Orientation) -> bool {
    matches!(
        o,
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    )
}

/// Read format and display dimensions from the file header only.
pub fn probe_file(path: &Path) -> Result<ImageHeader> {
    let reader = open_reader(path)?;
    let format = detect(&reader, path)?;
    let mut decoder = reader.into_decoder()?;
    let (w, h) = decoder.dimensions();
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let (width, height) = if swaps_axes(orientation) {
        (h, w)
    } else {
        (w, h)
    };
    Ok(ImageHeader {
        format,
        width,
        height,
    })
}

pub struct Decoded {
    pub image: RgbaImage,
    pub format: ImageFormat,
    pub has_alpha: bool,
    pub icc_profile: Option<Vec<u8>>,
}

/// Fully decode an image file to RGBA8, enforcing `limits` before allocation.
pub fn decode_file(path: &Path, limits: &Limits) -> Result<Decoded> {
    let mut reader = open_reader(path)?;
    let format = detect(&reader, path)?;
    let mut lim = image::Limits::default();
    lim.max_image_width = Some(limits.max_dimension);
    lim.max_image_height = Some(limits.max_dimension);
    // RGBA8 output plus decoder working memory.
    lim.max_alloc = Some(limits.max_pixels().saturating_mul(8).max(64 * 1024 * 1024));
    reader.limits(lim);
    let mut decoder = reader.into_decoder()?;
    let (w, h) = decoder.dimensions();
    limits.check(w, h, "Source image")?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let icc_profile = decoder.icc_profile().ok().flatten();
    let mut img = DynamicImage::from_decoder(decoder)?;
    img.apply_orientation(orientation);
    let has_alpha = img.color().has_alpha();
    Ok(Decoded {
        image: img.into_rgba8(),
        format,
        has_alpha,
        icc_profile,
    })
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PngOptimization {
    /// Standard zlib compression only.
    Off,
    /// Lossless optimisation pass (oxipng preset 2).
    #[default]
    Fast,
    /// Slower, more thorough lossless optimisation (oxipng preset 4).
    Max,
}

#[derive(Debug, Clone)]
pub struct EncodeOptions {
    pub format: ImageFormat,
    /// 1..=100, used by JPEG and lossy WebP.
    pub quality: u8,
    pub webp_lossless: bool,
    pub png_optimization: PngOptimization,
    /// Background used where transparency must be flattened (JPEG, BMP).
    pub flatten_background: [u8; 3],
    pub icc_profile: Option<Vec<u8>>,
}

/// Encode an RGBA image to bytes.
pub fn encode(img: &RgbaImage, opts: &EncodeOptions) -> Result<Vec<u8>> {
    let (w, h) = img.dimensions();
    let quality = opts.quality.clamp(1, 100);
    let mut out = Vec::new();
    match opts.format {
        ImageFormat::Jpeg => {
            let rgb = flatten(img, opts.flatten_background);
            let mut enc = JpegEncoder::new_with_quality(&mut out, quality);
            if let Some(icc) = &opts.icc_profile {
                let _ = enc.set_icc_profile(icc.clone());
            }
            enc.write_image(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)?;
        }
        ImageFormat::Png => {
            let opaque = is_opaque(img);
            {
                let compression = match opts.png_optimization {
                    PngOptimization::Off => CompressionType::Default,
                    _ => CompressionType::Best,
                };
                let mut enc =
                    PngEncoder::new_with_quality(&mut out, compression, PngFilter::Adaptive);
                if let Some(icc) = &opts.icc_profile {
                    let _ = enc.set_icc_profile(icc.clone());
                }
                if opaque {
                    let rgb = to_rgb(img);
                    enc.write_image(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)?;
                } else {
                    enc.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8)?;
                }
            }
            let preset = match opts.png_optimization {
                PngOptimization::Off => None,
                PngOptimization::Fast => Some(2),
                PngOptimization::Max => Some(4),
            };
            if let Some(level) = preset {
                let o = oxipng::Options::from_preset(level);
                if let Ok(optimized) = oxipng::optimize_from_memory(&out, &o) {
                    if optimized.len() < out.len() {
                        out = optimized;
                    }
                }
            }
        }
        ImageFormat::Webp => {
            let opaque = is_opaque(img);
            let rgb;
            let encoder = if opaque {
                rgb = to_rgb(img);
                webp::Encoder::from_rgb(rgb.as_raw(), w, h)
            } else {
                webp::Encoder::from_rgba(img.as_raw(), w, h)
            };
            let mem = encoder
                .encode_simple(opts.webp_lossless, quality as f32)
                .map_err(|e| EngineError::Encode(format!("WebP encoder failed: {e:?}")))?;
            out.extend_from_slice(&mem);
        }
        ImageFormat::Bmp => {
            let rgb = flatten(img, opts.flatten_background);
            let mut cursor = Cursor::new(&mut out);
            let enc = image::codecs::bmp::BmpEncoder::new(&mut cursor);
            enc.write_image(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)?;
        }
        ImageFormat::Tiff => {
            let mut cursor = Cursor::new(&mut out);
            let enc = image::codecs::tiff::TiffEncoder::new(&mut cursor);
            if is_opaque(img) {
                let rgb = to_rgb(img);
                enc.write_image(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8)?;
            } else {
                enc.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8)?;
            }
        }
        ImageFormat::Gif => {
            return Err(EngineError::UnsupportedFormat(
                "GIF output is not supported; choose PNG instead".into(),
            ))
        }
    }
    Ok(out)
}

/// Read back an encoded buffer's header (format + dimensions) for verification.
pub fn probe_bytes(bytes: &[u8]) -> Result<(ImageFormat, u32, u32)> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| EngineError::Io(e.to_string()))?;
    let fmt = reader
        .format()
        .and_then(ImageFormat::from_image_crate)
        .ok_or_else(|| EngineError::Verification("output format not recognised".into()))?;
    let (w, h) = reader.into_dimensions()?;
    Ok((fmt, w, h))
}

/// Encode a preview/thumbnail as a data URL (PNG when transparency matters, JPEG otherwise).
pub fn to_data_url(img: &RgbaImage) -> Result<String> {
    use base64::Engine;
    let (mime, bytes) = if is_opaque(img) {
        let mut out = Vec::new();
        let rgb = to_rgb(img);
        JpegEncoder::new_with_quality(&mut out, 88).write_image(
            rgb.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgb8,
        )?;
        ("image/jpeg", out)
    } else {
        let mut out = Vec::new();
        PngEncoder::new_with_quality(&mut out, CompressionType::Fast, PngFilter::Adaptive)
            .write_image(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::Rgba8,
            )?;
        ("image/png", out)
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn opts(format: ImageFormat) -> EncodeOptions {
        EncodeOptions {
            format,
            quality: 80,
            webp_lossless: false,
            png_optimization: PngOptimization::Fast,
            flatten_background: [255, 255, 255],
            icc_profile: None,
        }
    }

    fn sample(alpha: bool) -> RgbaImage {
        RgbaImage::from_fn(64, 48, |x, y| {
            Rgba([
                (x * 4) as u8,
                (y * 5) as u8,
                128,
                if alpha && x < 32 { 0 } else { 255 },
            ])
        })
    }

    #[test]
    fn every_writable_format_round_trips_dimensions() {
        for f in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::Webp,
            ImageFormat::Bmp,
            ImageFormat::Tiff,
        ] {
            for alpha in [false, true] {
                let bytes = encode(&sample(alpha), &opts(f)).unwrap();
                let (pf, w, h) = probe_bytes(&bytes).unwrap();
                assert_eq!((pf, w, h), (f, 64, 48), "{f:?}");
                let decoded = image::load_from_memory(&bytes).unwrap();
                assert_eq!(
                    decoded.color().has_alpha(),
                    alpha && f.supports_alpha(),
                    "{f:?} alpha={alpha}"
                );
            }
        }
        assert!(encode(&sample(false), &opts(ImageFormat::Gif)).is_err());
    }

    #[test]
    fn png_preserves_transparency_exactly() {
        let src = sample(true);
        let bytes = encode(&src, &opts(ImageFormat::Png)).unwrap();
        let back = image::load_from_memory(&bytes).unwrap().into_rgba8();
        assert_eq!(back, src);
    }

    #[test]
    fn jpeg_flattens_onto_background() {
        let src = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, 0]));
        let mut o = opts(ImageFormat::Jpeg);
        o.flatten_background = [255, 0, 0];
        o.quality = 100;
        let bytes = encode(&src, &o).unwrap();
        let p = image::load_from_memory(&bytes)
            .unwrap()
            .into_rgb8()
            .get_pixel(8, 8)
            .0;
        assert!(p[0] > 240 && p[1] < 20 && p[2] < 20, "{p:?}");
    }

    #[test]
    fn lower_quality_gives_smaller_jpeg() {
        let src = RgbaImage::from_fn(256, 256, |x, y| {
            Rgba([(x ^ y) as u8, (x * y) as u8, (x + y) as u8, 255])
        });
        let mut o = opts(ImageFormat::Jpeg);
        o.quality = 95;
        let hi = encode(&src, &o).unwrap().len();
        o.quality = 30;
        let lo = encode(&src, &o).unwrap().len();
        assert!(lo < hi);
        let mut o = opts(ImageFormat::Webp);
        o.quality = 95;
        let hi = encode(&src, &o).unwrap().len();
        o.quality = 30;
        let lo = encode(&src, &o).unwrap().len();
        assert!(lo < hi);
    }

    #[test]
    fn extension_mapping() {
        assert_eq!(ImageFormat::from_extension("JPEG"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_extension("heic"), None);
        assert_eq!(ImageFormat::Jpeg.extension(), "jpg");
    }
}
