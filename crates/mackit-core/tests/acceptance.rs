//! End-to-end acceptance tests: real files in, real files out, dimensions read back
//! from disk. These mirror the acceptance criteria in the MacKit specification.

use image::{GenericImageView, Rgba, RgbaImage};
use mackit_core::batch::{preflight, run, BatchEvent, BatchItem, BatchJob, ItemStatus};
use mackit_core::color::Color;
use mackit_core::export::{ConflictPolicy, ExportOptions, OutputFormat};
use mackit_core::geometry::{
    Anchor, Background, CropSpec, Limits, Placement, ResizeMode, ResizeSpec,
};
use mackit_core::ops::Operation;
use mackit_core::watermark::{SizeUnit, WatermarkKind, WatermarkSpec};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

const MAGENTA: [u8; 4] = [255, 0, 255, 255];

/// Image with colored 20px corner blocks so we can prove nothing was cut off.
fn marked(w: u32, h: u32) -> RgbaImage {
    RgbaImage::from_fn(w, h, |x, y| {
        let (l, r, t, b) = (x < 20, x >= w - 20, y < 20, y >= h - 20);
        Rgba(match (l, r, t, b) {
            (true, _, true, _) => [255, 0, 0, 255],
            (_, true, true, _) => [0, 255, 0, 255],
            (true, _, _, true) => [0, 0, 255, 255],
            (_, true, _, true) => [255, 255, 0, 255],
            _ => [120, 120, 120, 255],
        })
    })
}

fn save(dir: &Path, name: &str, img: &RgbaImage) -> PathBuf {
    let p = dir.join(name);
    img.save(&p).unwrap();
    p
}

fn resize(mode: ResizeMode, w: u32, h: u32) -> ResizeSpec {
    ResizeSpec {
        mode,
        width: w,
        height: h,
        background: Background {
            color: Color::rgb(255, 0, 255),
            transparent: false,
        },
        ..Default::default()
    }
}

fn job(paths: &[&Path], ops: Vec<Operation>, export: ExportOptions) -> BatchJob {
    BatchJob {
        items: paths
            .iter()
            .map(|p| BatchItem {
                path: p.display().to_string(),
                rel_dir: None,
                operations: None,
            })
            .collect(),
        operations: ops,
        export,
        limits: Limits::default(),
        concurrency: 2,
    }
}

fn export_to(dir: &Path, format: OutputFormat, suffix: &str) -> ExportOptions {
    ExportOptions {
        output_dir: Some(dir.display().to_string()),
        format,
        suffix: suffix.into(),
        ..Default::default()
    }
}

struct Run {
    events: Vec<BatchEvent>,
    summary: mackit_core::batch::BatchSummary,
}

fn execute(job: &BatchJob) -> Run {
    let events = Mutex::new(Vec::new());
    let cancel = AtomicBool::new(false);
    let summary = run(job, &cancel, &|e| events.lock().unwrap().push(e));
    Run {
        events: events.into_inner().unwrap(),
        summary,
    }
}

fn finished_items(r: &Run) -> Vec<mackit_core::batch::ItemUpdate> {
    let mut v: Vec<_> = r
        .events
        .iter()
        .filter_map(|e| match e {
            BatchEvent::Item(u) if u.status != ItemStatus::Processing => Some(u.clone()),
            _ => None,
        })
        .collect();
    v.sort_by_key(|u| u.index);
    v
}

fn near(a: [u8; 4], b: [u8; 4]) -> bool {
    a.iter()
        .zip(b)
        .all(|(x, y)| (*x as i32 - y as i32).abs() <= 45)
}

#[test]
fn test1_fit_landscape_into_590x300() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "photo.png", &marked(1200, 800));
    let original = fs::read(&src).unwrap();
    let r = execute(&job(
        &[&src],
        vec![Operation::Resize(resize(ResizeMode::Fit, 590, 300))],
        export_to(out.path(), OutputFormat::Png, "-{w}x{h}"),
    ));
    assert_eq!(r.summary.succeeded, 1, "{:?}", r.events);
    let path = out.path().join("photo-590x300.png");
    let img = image::open(&path).unwrap();
    assert_eq!(img.dimensions(), (590, 300), "actual file dimensions");
    let img = img.to_rgba8();
    // whole image present: all four marker corners at the edges of the 450×300 image area (x 70..520)
    assert!(near(img.get_pixel(72, 2).0, [255, 0, 0, 255]));
    assert!(near(img.get_pixel(517, 2).0, [0, 255, 0, 255]));
    assert!(near(img.get_pixel(72, 297).0, [0, 0, 255, 255]));
    assert!(near(img.get_pixel(517, 297).0, [255, 255, 0, 255]));
    // padding left and right
    assert_eq!(img.get_pixel(30, 150).0, MAGENTA);
    assert_eq!(img.get_pixel(560, 150).0, MAGENTA);
    assert_eq!(fs::read(&src).unwrap(), original, "original untouched");
}

#[test]
fn test2_square_thumbnail_keeps_whole_image() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "photo.png", &marked(1200, 800));
    let r = execute(&job(
        &[&src],
        vec![Operation::Resize(resize(ResizeMode::Fit, 80, 80))],
        export_to(dir.path(), OutputFormat::Png, "-thumb"),
    ));
    assert_eq!(r.summary.succeeded, 1);
    let img = image::open(dir.path().join("photo-thumb.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(img.dimensions(), (80, 80));
    // 80×53 image centred vertically; top and bottom bands are padding, sides are not cut
    assert_eq!(img.get_pixel(40, 2).0, MAGENTA);
    assert_eq!(img.get_pixel(40, 78).0, MAGENTA);
    let row = 40;
    assert!(
        !near(img.get_pixel(0, row).0, MAGENTA),
        "left edge is image, not padding"
    );
    assert!(
        !near(img.get_pixel(79, row).0, MAGENTA),
        "right edge is image, not padding"
    );
    // corner markers are still there (compressed to ~1px): top-left of image area is reddish
    let top = (80 - 53) / 2 + 1;
    assert!(img.get_pixel(0, top as u32).0[0] > 150);
}

#[test]
fn test3_canvas_preserves_original_scale() {
    let dir = tempfile::tempdir().unwrap();
    let src_img = marked(800, 600);
    let src = save(dir.path(), "photo.png", &src_img);
    let r = execute(&job(
        &[&src],
        vec![Operation::Resize(resize(ResizeMode::Canvas, 1200, 1000))],
        export_to(dir.path(), OutputFormat::Png, "-canvas"),
    ));
    assert_eq!(r.summary.succeeded, 1);
    let img = image::open(dir.path().join("photo-canvas.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(img.dimensions(), (1200, 1000));
    for (x, y, p) in src_img.enumerate_pixels() {
        assert_eq!(
            img.get_pixel(x + 200, y + 200),
            p,
            "pixel ({x},{y}) copied 1:1"
        );
    }
    assert_eq!(img.get_pixel(100, 100).0, MAGENTA);
}

#[test]
fn test4_smaller_canvas_refuses_and_explains() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "photo.png", &marked(1200, 800));
    let j = job(
        &[&src],
        vec![Operation::Resize(resize(ResizeMode::Canvas, 590, 300))],
        export_to(dir.path(), OutputFormat::Png, "-canvas"),
    );
    let pf = preflight(&j).unwrap();
    let err = pf.items[0]
        .error
        .as_ref()
        .expect("preflight reports the problem");
    assert_eq!(err.code, "does_not_fit");
    assert!(err.message.contains("never crops"));
    let r = execute(&j);
    assert_eq!(r.summary.failed, 1);
    assert!(
        !dir.path().join("photo-canvas.png").exists(),
        "nothing written, nothing cropped"
    );

    // the offered alternative (scale proportionally) works and keeps the whole image
    let mut spec = resize(ResizeMode::Canvas, 590, 300);
    spec.scale_image = true;
    let r = execute(&job(
        &[&src],
        vec![Operation::Resize(spec)],
        export_to(dir.path(), OutputFormat::Png, "-canvas"),
    ));
    assert_eq!(r.summary.succeeded, 1);
    assert_eq!(
        image::open(dir.path().join("photo-canvas.png"))
            .unwrap()
            .dimensions(),
        (590, 300)
    );
}

#[test]
fn test5_stretch_exact_with_warning() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "photo.png", &marked(1200, 800));
    let ops = vec![Operation::Resize(resize(ResizeMode::Stretch, 590, 300))];
    let plan = mackit_core::ops::plan_pipeline(1200, 800, &ops, &Limits::default()).unwrap();
    assert!(plan.warnings.iter().any(|w| w.contains("distorted")));
    let r = execute(&job(
        &[&src],
        ops,
        export_to(dir.path(), OutputFormat::Png, "-stretched"),
    ));
    assert_eq!(r.summary.succeeded, 1);
    let img = image::open(dir.path().join("photo-stretched.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(img.dimensions(), (590, 300));
    assert!(near(img.get_pixel(2, 2).0, [255, 0, 0, 255]));
    assert!(near(img.get_pixel(587, 297).0, [255, 255, 0, 255]));
}

#[test]
fn test6_transparent_png_with_transparent_padding() {
    let dir = tempfile::tempdir().unwrap();
    let mut src_img = RgbaImage::from_pixel(400, 200, Rgba([20, 120, 220, 255]));
    for y in 0..100 {
        for x in 0..100 {
            src_img.put_pixel(x, y, Rgba([0, 0, 0, 0])); // transparent region top-left
        }
    }
    let src = save(dir.path(), "logo.png", &src_img);
    for mode in [ResizeMode::Fit, ResizeMode::Canvas] {
        let mut spec = resize(mode, 800, 800);
        spec.background.transparent = true;
        let r = execute(&job(
            &[&src],
            vec![Operation::Resize(spec)],
            export_to(dir.path(), OutputFormat::Png, "-pad"),
        ));
        assert_eq!(r.summary.succeeded, 1);
        let out = image::open(finished_items(&r)[0].output_path.as_ref().unwrap()).unwrap();
        assert!(out.color().has_alpha());
        let out = out.to_rgba8();
        assert_eq!(out.dimensions(), (800, 800));
        assert_eq!(
            out.get_pixel(5, 5).0[3],
            0,
            "{mode:?}: padding is transparent"
        );
        assert_eq!(
            out.get_pixel(400, 795).0[3],
            0,
            "{mode:?}: bottom padding transparent"
        );
        match mode {
            ResizeMode::Canvas => {
                // image at (200,300); its transparent block occupies (200..300, 300..400)
                assert_eq!(out.get_pixel(250, 350).0[3], 0);
                assert_eq!(out.get_pixel(450, 450).0, [20, 120, 220, 255]);
            }
            _ => {
                // scaled 2x to 800×400 at y=200; transparent block -> (0..200, 200..400)
                assert_eq!(out.get_pixel(100, 300).0[3], 0);
                assert_eq!(out.get_pixel(600, 500).0, [20, 120, 220, 255]);
            }
        }
    }
}

#[test]
fn test7_reported_dimensions_are_read_back_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "photo.png", &marked(1000, 700));
    for (fmt, ext) in [
        (OutputFormat::Png, "png"),
        (OutputFormat::Jpeg, "jpg"),
        (OutputFormat::Webp, "webp"),
        (OutputFormat::Tiff, "tiff"),
        (OutputFormat::Bmp, "bmp"),
    ] {
        let r = execute(&job(
            &[&src],
            vec![Operation::Resize(resize(ResizeMode::Fit, 333, 222))],
            export_to(dir.path(), fmt, "-v"),
        ));
        let u = &finished_items(&r)[0];
        assert_eq!(u.status, ItemStatus::Done, "{fmt:?}: {:?}", u.message);
        let p = u.output_path.as_ref().unwrap();
        assert!(p.ends_with(ext));
        let real = image::open(p).unwrap().dimensions();
        assert_eq!(real, (333, 222));
        assert_eq!((u.output_w, u.output_h), (Some(333), Some(222)));
        assert_eq!(
            u.output_bytes,
            Some(fs::metadata(p).unwrap().len()),
            "reported size is the real file size"
        );
    }
}

#[test]
fn crop_is_the_only_mode_that_removes_content() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "photo.png", &marked(1200, 800));
    let has_all_corners = |img: &RgbaImage| {
        let colors = [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [0, 0, 255, 255],
            [255, 255, 0, 255],
        ];
        colors.iter().all(|c| img.pixels().any(|p| near(p.0, *c)))
    };
    let modes: Vec<(&str, Operation)> = vec![
        ("fit", Operation::Resize(resize(ResizeMode::Fit, 590, 300))),
        (
            "canvas",
            Operation::Resize(ResizeSpec {
                scale_image: true,
                ..resize(ResizeMode::Canvas, 590, 300)
            }),
        ),
        (
            "stretch",
            Operation::Resize(resize(ResizeMode::Stretch, 590, 300)),
        ),
        (
            "percent",
            Operation::Resize(ResizeSpec {
                percent: 50.0,
                ..resize(ResizeMode::Percent, 0, 0)
            }),
        ),
        (
            "crop",
            Operation::Crop(CropSpec {
                x: 0,
                y: 0,
                width: 600,
                height: 400,
            }),
        ),
    ];
    for (name, op) in modes {
        let r = execute(&job(
            &[&src],
            vec![op],
            export_to(dir.path(), OutputFormat::Png, &format!("-{name}")),
        ));
        assert_eq!(r.summary.succeeded, 1);
        let img = image::open(dir.path().join(format!("photo-{name}.png")))
            .unwrap()
            .to_rgba8();
        assert_eq!(has_all_corners(&img), name != "crop", "{name}");
    }
}

#[test]
fn batch_errors_do_not_stop_other_files_and_originals_are_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let a = save(dir.path(), "a.png", &marked(300, 200));
    let b = dir.path().join("b.jpg");
    fs::write(&b, b"this is not a jpeg").unwrap();
    let c = save(dir.path(), "c.png", &marked(200, 300));
    let before: Vec<Vec<u8>> = [&a, &b, &c].iter().map(|p| fs::read(p).unwrap()).collect();

    let r = execute(&job(
        &[&a, &b, &c],
        vec![Operation::Resize(resize(ResizeMode::Fit, 100, 100))],
        export_to(out.path(), OutputFormat::Jpeg, "-s"),
    ));
    assert_eq!((r.summary.succeeded, r.summary.failed), (2, 1));
    let items = finished_items(&r);
    assert_eq!(items[1].status, ItemStatus::Failed);
    assert!(items[1].message.is_some());
    assert!(out.path().join("a-s.jpg").exists());
    assert!(out.path().join("c-s.jpg").exists());
    let after: Vec<Vec<u8>> = [&a, &b, &c].iter().map(|p| fs::read(p).unwrap()).collect();
    assert_eq!(before, after);
    assert!(matches!(r.events.last(), Some(BatchEvent::Finished(_))));
}

#[test]
fn same_name_outputs_never_overwrite_sources_or_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let a = save(dir.path(), "photo.png", &marked(100, 100));
    let original = fs::read(&a).unwrap();
    // No suffix, same folder, same format => output path == source path.
    let mut export = ExportOptions {
        output_dir: None,
        format: OutputFormat::Source,
        suffix: String::new(),
        conflict: ConflictPolicy::Replace,
        ..Default::default()
    };
    let j = job(
        &[&a],
        vec![Operation::Resize(resize(ResizeMode::Fit, 50, 50))],
        export.clone(),
    );
    let pf = preflight(&j).unwrap();
    assert_eq!(pf.source_overwrites, 1);
    let r = execute(&j);
    assert_eq!(r.summary.failed, 1);
    assert_eq!(
        finished_items(&r)[0].error.as_ref().unwrap().code,
        "would_overwrite_source"
    );
    assert_eq!(
        fs::read(&a).unwrap(),
        original,
        "source untouched even with Replace policy"
    );

    // Two different sources mapping to the same output name in one batch.
    let b_dir = dir.path().join("other");
    fs::create_dir(&b_dir).unwrap();
    let b = save(&b_dir, "photo.png", &marked(100, 100));
    let out = tempfile::tempdir().unwrap();
    export.output_dir = Some(out.path().display().to_string());
    export.suffix = "-x".into();
    export.conflict = ConflictPolicy::Rename;
    let j = job(
        &[&a, &b],
        vec![Operation::Resize(resize(ResizeMode::Fit, 50, 50))],
        export,
    );
    let pf = preflight(&j).unwrap();
    assert!(pf.items[1].deduplicated);
    let r = execute(&j);
    assert_eq!(r.summary.succeeded, 2);
    assert!(out.path().join("photo-x.png").exists());
    assert!(out.path().join("photo-x-1.png").exists());
}

#[test]
fn conflict_policies_with_existing_outputs() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "p.png", &marked(100, 100));
    let existing = dir.path().join("p-out.png");
    fs::write(&existing, b"keep me").unwrap();
    let mk = |policy| {
        job(
            &[&src],
            vec![Operation::Resize(resize(ResizeMode::Percent, 0, 0))],
            ExportOptions {
                suffix: "-out".into(),
                conflict: policy,
                ..Default::default()
            },
        )
    };
    let pf = preflight(&mk(ConflictPolicy::Skip)).unwrap();
    assert_eq!(pf.conflicts, 1);
    let r = execute(&mk(ConflictPolicy::Skip));
    assert_eq!(r.summary.skipped, 1);
    assert_eq!(fs::read(&existing).unwrap(), b"keep me");
    let r = execute(&mk(ConflictPolicy::Rename));
    assert_eq!(r.summary.succeeded, 1);
    assert_eq!(fs::read(&existing).unwrap(), b"keep me");
    assert!(dir.path().join("p-out-1.png").exists());
    let r = execute(&mk(ConflictPolicy::Replace));
    assert!(finished_items(&r)[0].replaced);
    assert_eq!(image::open(&existing).unwrap().dimensions(), (100, 100));
}

#[test]
fn cancellation_leaves_no_partial_files() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let paths: Vec<PathBuf> = (0..6)
        .map(|i| save(dir.path(), &format!("f{i}.png"), &marked(400, 300)))
        .collect();
    let refs: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
    let j = job(
        &refs,
        vec![Operation::Resize(resize(ResizeMode::Fit, 100, 100))],
        export_to(out.path(), OutputFormat::Png, "-c"),
    );
    let cancel = AtomicBool::new(false);
    let seen = Mutex::new(0usize);
    let summary = run(&j, &cancel, &|e| {
        if let BatchEvent::Item(u) = e {
            if u.status == ItemStatus::Done {
                let mut s = seen.lock().unwrap();
                *s += 1;
                if *s == 1 {
                    cancel.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }
        }
    });
    assert!(summary.was_cancelled);
    assert!(summary.cancelled >= 1);
    assert_eq!(
        summary.succeeded + summary.cancelled + summary.failed + summary.skipped,
        6
    );
    for e in fs::read_dir(out.path()).unwrap() {
        let p = e.unwrap().path();
        assert!(
            !p.to_string_lossy().ends_with(".tmp"),
            "temp file left: {}",
            p.display()
        );
        image::open(&p).expect("every written file is complete and valid");
    }
}

#[test]
fn format_conversion_and_transparency_to_jpeg() {
    let dir = tempfile::tempdir().unwrap();
    let mut img = RgbaImage::from_pixel(64, 64, Rgba([0, 0, 0, 0]));
    for y in 32..64 {
        for x in 0..64 {
            img.put_pixel(x, y, Rgba([0, 200, 0, 255]));
        }
    }
    let src = save(dir.path(), "t.png", &img);
    let r = execute(&job(
        &[&src],
        vec![],
        ExportOptions {
            format: OutputFormat::Jpeg,
            flatten_background: Color::rgb(255, 0, 0),
            suffix: "".into(),
            quality: 95,
            ..Default::default()
        },
    ));
    let u = &finished_items(&r)[0];
    assert_eq!(u.status, ItemStatus::Done);
    assert!(u.message.as_ref().unwrap().contains("no transparency"));
    let jpg = image::open(dir.path().join("t.jpg")).unwrap().to_rgb8();
    assert!(
        jpg.get_pixel(10, 10).0[0] > 230,
        "transparent area filled with chosen background"
    );

    // JPEG -> PNG -> WebP chain keeps dimensions
    let r = execute(&job(
        &[&dir.path().join("t.jpg")],
        vec![],
        ExportOptions {
            format: OutputFormat::Webp,
            suffix: "".into(),
            ..Default::default()
        },
    ));
    assert_eq!(r.summary.succeeded, 1);
    let webp = dir.path().join("t.webp");
    assert_eq!(image::open(&webp).unwrap().dimensions(), (64, 64));
    let r = execute(&job(
        &[&webp],
        vec![],
        ExportOptions {
            format: OutputFormat::Png,
            suffix: "-back".into(),
            ..Default::default()
        },
    ));
    assert_eq!(r.summary.succeeded, 1);
    assert_eq!(
        image::open(dir.path().join("t-back.png"))
            .unwrap()
            .dimensions(),
        (64, 64)
    );
}

#[test]
fn compression_reports_real_sizes() {
    let dir = tempfile::tempdir().unwrap();
    let img = RgbaImage::from_fn(512, 512, |x, y| {
        Rgba([
            (x ^ y) as u8,
            (x.wrapping_mul(y) >> 3) as u8,
            (x + y) as u8,
            255,
        ])
    });
    let src = dir.path().join("big.jpg");
    image::DynamicImage::ImageRgba8(img)
        .to_rgb8()
        .save_with_format(&src, image::ImageFormat::Jpeg)
        .unwrap();
    let r = execute(&job(
        &[&src],
        vec![],
        ExportOptions {
            format: OutputFormat::Jpeg,
            quality: 40,
            suffix: "-small".into(),
            ..Default::default()
        },
    ));
    let u = &finished_items(&r)[0];
    let real = fs::metadata(dir.path().join("big-small.jpg"))
        .unwrap()
        .len();
    assert_eq!(u.output_bytes, Some(real));
    assert_eq!(u.input_bytes, fs::metadata(&src).unwrap().len());
    assert!(real < u.input_bytes);
}

#[test]
fn watermark_batch_on_mixed_sizes() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let logo = save(
        dir.path(),
        "logo.png",
        &RgbaImage::from_pixel(100, 50, Rgba([255, 255, 255, 255])),
    );
    let a = save(
        dir.path(),
        "a.png",
        &RgbaImage::from_pixel(1000, 500, Rgba([0, 0, 0, 255])),
    );
    let b = save(
        dir.path(),
        "b.png",
        &RgbaImage::from_pixel(400, 800, Rgba([0, 0, 0, 255])),
    );
    let wm = WatermarkSpec {
        kind: WatermarkKind::Logo,
        logo_path: Some(logo.display().to_string()),
        logo_size_unit: SizeUnit::PercentOfWidth,
        logo_percent: 10.0,
        opacity: 1.0,
        placement: Placement::at(Anchor::BottomRight),
        margin_x: 0.0,
        margin_y: 0.0,
        ..Default::default()
    };
    let text = WatermarkSpec {
        kind: WatermarkKind::Text,
        text: "© 2026".into(),
        font_size: 5.0,
        placement: Placement::at(Anchor::TopLeft),
        ..wm.clone()
    };
    let r = execute(&job(
        &[&a, &b],
        vec![Operation::Watermark(wm), Operation::Watermark(text)],
        export_to(out.path(), OutputFormat::Png, "-watermarked"),
    ));
    assert_eq!(r.summary.succeeded, 2, "{:?}", r.events);
    let a_out = image::open(out.path().join("a-watermarked.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(a_out.dimensions(), (1000, 500));
    // logo is 100×50 at bottom-right of a 1000×500 image
    assert_eq!(a_out.get_pixel(999, 499).0, [255, 255, 255, 255]);
    assert_eq!(a_out.get_pixel(905, 455).0, [255, 255, 255, 255]);
    assert_eq!(a_out.get_pixel(880, 455).0, [0, 0, 0, 255]);
    let b_out = image::open(out.path().join("b-watermarked.png"))
        .unwrap()
        .to_rgba8();
    // logo is 40×20 on the 400 px wide image
    assert_eq!(b_out.get_pixel(399, 799).0, [255, 255, 255, 255]);
    assert_eq!(b_out.get_pixel(355, 790).0, [0, 0, 0, 255]);
}

#[test]
fn preserve_folder_structure() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join("trip/day1")).unwrap();
    save(&dir.path().join("trip/day1"), "x.png", &marked(50, 50));
    save(dir.path(), "y.png", &marked(50, 50));
    let scan = mackit_core::scan::scan_paths(&[dir.path().to_path_buf()], true, 100);
    assert_eq!(scan.files.len(), 2);
    let j = BatchJob {
        items: scan
            .files
            .iter()
            .map(|f| BatchItem {
                path: f.path.clone(),
                rel_dir: f.rel_dir.clone(),
                operations: None,
            })
            .collect(),
        operations: vec![],
        export: ExportOptions {
            output_dir: Some(out.path().display().to_string()),
            suffix: "".into(),
            ..Default::default()
        },
        limits: Limits::default(),
        concurrency: 1,
    };
    assert_eq!(execute(&j).summary.succeeded, 2);
    assert!(out.path().join("trip/day1/x.png").exists());
    assert!(out.path().join("y.png").exists());
}

#[test]
fn oversized_images_are_rejected_safely() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "p.png", &marked(500, 500));
    let mut j = job(
        &[&src],
        vec![Operation::Resize(resize(ResizeMode::Percent, 0, 0))],
        ExportOptions {
            suffix: "-big".into(),
            ..Default::default()
        },
    );
    j.limits = Limits {
        max_dimension: 400,
        max_megapixels: 1,
    };
    let r = execute(&j);
    assert_eq!(r.summary.failed, 1);
    assert_eq!(
        finished_items(&r)[0].error.as_ref().unwrap().code,
        "too_large"
    );
}

#[test]
fn measured_size_matches_written_file() {
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "m.png", &marked(640, 480));
    let export = ExportOptions {
        format: OutputFormat::Jpeg,
        quality: 70,
        suffix: "-m".into(),
        ..Default::default()
    };
    let ops = vec![Operation::Resize(ResizeSpec {
        mode: ResizeMode::Within,
        width: 320,
        height: 320,
        ..Default::default()
    })];
    let m = mackit_core::batch::measure_output(&src, &ops, &export, &Limits::default()).unwrap();
    assert_eq!((m.width, m.height), (320, 240));
    let r = execute(&job(&[&src], ops, export));
    let u = &finished_items(&r)[0];
    assert_eq!(
        u.output_bytes,
        Some(m.bytes),
        "in-memory measurement equals the real file size"
    );
}

/// The exact JSON shapes the TypeScript frontend sends (see src/services/image-processing
/// and src/services/file-export). Guards against field-name drift between TS and Rust.
#[test]
fn frontend_wire_format_deserializes() {
    let job = r##"{
      "items": [{ "path": "/tmp/a.png", "relDir": null }, { "path": "/tmp/b.png", "relDir": "sub" }],
      "operations": [
        { "type": "crop", "x": 1, "y": 2, "width": 30, "height": 40 },
        { "type": "resize", "mode": "within", "width": 1200, "height": 628, "percent": 100, "scaleImage": false,
          "allowUpscale": true, "placement": { "anchor": "center", "x": 0.5, "y": 0.5 },
          "background": { "color": "#ffffff", "transparent": false }, "filter": "lanczos3" },
        { "type": "watermark", "kind": "logo", "logoPath": "/tmp/logo.png", "logoSizeUnit": "percentOfWidth",
          "logoPercent": 20, "logoWidth": 200, "logoHeight": 200, "keepAspect": true, "text": "© Your Name",
          "fontSize": 4, "fontSizeUnit": "percentOfWidth", "color": "#ffffff", "bold": true, "opacity": 0.8,
          "placement": { "anchor": "bottomRight", "x": 0.5, "y": 0.5 }, "marginX": 2, "marginY": 2, "marginUnit": "percentOfWidth" }
      ],
      "export": { "outputDir": null, "format": "source", "quality": 85, "webpLossless": false, "pngOptimization": "fast",
        "flattenBackground": "#ffffff", "filenameTemplate": "{name}{suffix}", "suffix": "-{w}x{h}", "conflict": "rename",
        "preserveStructure": true, "allowSourceOverwrite": false }
    }"##;
    let j: BatchJob = serde_json::from_str(job).expect("frontend job JSON must deserialize");
    assert_eq!(j.items[1].rel_dir.as_deref(), Some("sub"));
    assert_eq!(j.operations.len(), 3);
    assert_eq!(j.concurrency, 2);
    match &j.operations[2] {
        Operation::Watermark(w) => {
            assert_eq!(w.logo_path.as_deref(), Some("/tmp/logo.png"));
            assert_eq!(w.placement.anchor, Anchor::BottomRight);
            assert_eq!(w.margin_unit, SizeUnit::PercentOfWidth);
        }
        _ => panic!(),
    }
}

#[test]
fn rotate_to_portrait_and_adjust_export() {
    use mackit_core::adjust::{AdjustSpec, Curves, TransformSpec};
    let dir = tempfile::tempdir().unwrap();
    let src = save(dir.path(), "land.png", &marked(1200, 800));
    let ops = vec![
        Operation::Transform(TransformSpec {
            rotate: 90,
            ..Default::default()
        }),
        Operation::Adjust(AdjustSpec {
            brightness: 20.0,
            contrast: 15.0,
            curves: Curves {
                rgb: vec![[0.0, 0.0], [0.25, 0.2], [0.75, 0.8], [1.0, 1.0]],
                ..Default::default()
            },
            ..Default::default()
        }),
    ];
    let r = execute(&job(
        &[&src],
        ops,
        export_to(dir.path(), OutputFormat::Png, "-enhanced"),
    ));
    assert_eq!(r.summary.succeeded, 1, "{:?}", r.events);
    let out = image::open(dir.path().join("land-enhanced.png"))
        .unwrap()
        .to_rgba8();
    assert_eq!(out.dimensions(), (800, 1200), "landscape became portrait");
    // red top-left corner is now top-right after a clockwise rotation
    assert!(near(out.get_pixel(790, 5).0, [255, 0, 0, 255]));
}

/// The UI converts a dragged rectangle into custom X/Y fractions using the
/// returned layout; re-planning with those fractions must land on the same spot.
#[test]
fn drag_position_round_trips() {
    use mackit_core::ops::{watermark_layouts, Resources};
    let mut res = Resources::default();
    res.insert_logo(
        "logo",
        std::sync::Arc::new(RgbaImage::from_pixel(200, 100, Rgba([255, 255, 255, 255]))),
    );
    let mut wm = WatermarkSpec {
        logo_path: Some("logo".into()),
        logo_size_unit: SizeUnit::Pixels,
        logo_width: 200,
        margin_x: 20.0,
        margin_y: 20.0,
        margin_unit: SizeUnit::Pixels,
        ..Default::default()
    };
    let lay = watermark_layouts(
        1000,
        600,
        &[Operation::Watermark(wm.clone())],
        &res,
        &Limits::default(),
    )[0];
    assert_eq!((lay.rect.w, lay.rect.h), (200.0, 100.0));
    // user drags the logo so its top-left sits at (300, 150)
    let (tx, ty) = (300.0, 150.0);
    wm.placement = Placement {
        anchor: Anchor::Custom,
        x: (tx - lay.area.x) / (lay.area.w - lay.rect.w),
        y: (ty - lay.area.y) / (lay.area.h - lay.rect.h),
    };
    let after = watermark_layouts(
        1000,
        600,
        &[Operation::Watermark(wm)],
        &res,
        &Limits::default(),
    )[0];
    assert!((after.rect.x - tx).abs() < 1e-9 && (after.rect.y - ty).abs() < 1e-9);
}

#[test]
fn per_item_operations_override_the_job() {
    let dir = tempfile::tempdir().unwrap();
    let out = tempfile::tempdir().unwrap();
    let a = save(dir.path(), "a.png", &marked(300, 200));
    let b = save(dir.path(), "b.png", &marked(300, 200));
    let mut j = job(
        &[&a, &b],
        vec![Operation::Resize(resize(ResizeMode::Stretch, 150, 100))],
        export_to(out.path(), OutputFormat::Png, "-x"),
    );
    // Second photo gets its own pipeline.
    j.items[1].operations = Some(vec![Operation::Resize(resize(ResizeMode::Stretch, 60, 40))]);
    let r = execute(&j);
    let items = finished_items(&r);
    assert_eq!(items[0].output_w, Some(150));
    assert_eq!(items[1].output_w, Some(60));
    assert_eq!(items[1].output_h, Some(40));
}
