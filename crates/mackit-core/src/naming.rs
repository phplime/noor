//! Output filename generation and sanitisation.

use std::path::{Component, Path, PathBuf};

/// Values available to filename templates.
#[derive(Debug, Clone)]
pub struct NameContext<'a> {
    /// Source filename without extension.
    pub stem: &'a str,
    pub suffix: &'a str,
    pub width: u32,
    pub height: u32,
    /// 1-based position in the batch.
    pub index: usize,
    /// Output extension without dot (e.g. "jpg").
    pub ext: &'a str,
}

/// Supported tokens: `{name}`, `{suffix}`, `{w}`, `{h}`, `{index}`, `{ext}`.
/// The suffix itself may also contain tokens (e.g. `-{w}x{h}`).
pub fn render_template(template: &str, ctx: &NameContext) -> String {
    let template = if template.trim().is_empty() {
        "{name}{suffix}"
    } else {
        template
    };
    let expanded = template.replace("{suffix}", ctx.suffix);
    expanded
        .replace("{name}", ctx.stem)
        .replace("{w}", &ctx.width.to_string())
        .replace("{h}", &ctx.height.to_string())
        .replace("{index}", &format!("{:03}", ctx.index))
        .replace("{ext}", ctx.ext)
}

/// Make a string safe to use as a single filename component on macOS (and other
/// platforms): no path separators, no control characters, no leading dots, no
/// reserved names, bounded length.
pub fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    let mut out = if trimmed.is_empty() || trimmed == ".." {
        "image".to_string()
    } else {
        trimmed.to_string()
    };
    // Keep well below the 255-byte APFS limit, leaving room for " (999)" and an extension.
    while out.len() > 200 {
        out.pop();
    }
    out
}

/// Build the full output filename `<rendered>.<ext>`.
pub fn output_file_name(template: &str, ctx: &NameContext) -> String {
    let base = sanitize_component(&render_template(template, ctx));
    format!("{base}.{}", ctx.ext)
}

/// Validate a relative sub-directory used to preserve folder structure.
/// Returns `None` when it contains anything other than normal components.
pub fn safe_relative_dir(rel: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for c in rel.components() {
        match c {
            Component::Normal(part) => {
                let s = part.to_str()?;
                out.push(sanitize_component(s));
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

/// `photo.png` -> `photo-1.png`, `photo-2.png`, … (first that `exists` reports free).
pub fn next_available(path: &Path, exists: impl Fn(&Path) -> bool) -> PathBuf {
    if !exists(path) {
        return path.to_path_buf();
    }
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext = path.extension().and_then(|s| s.to_str());
    for i in 1..100_000 {
        let name = match ext {
            Some(e) => format!("{stem}-{i}.{e}"),
            None => format!("{stem}-{i}"),
        };
        let candidate = parent.join(name);
        if !exists(&candidate) {
            return candidate;
        }
    }
    // Practically unreachable; fall back to a timestamped name.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    parent.join(format!("{stem}-{ts}.{}", ext.unwrap_or("out")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn ctx<'a>(suffix: &'a str, ext: &'a str) -> NameContext<'a> {
        NameContext {
            stem: "photo",
            suffix,
            width: 590,
            height: 300,
            index: 7,
            ext,
        }
    }

    #[test]
    fn spec_examples() {
        assert_eq!(
            output_file_name("{name}{suffix}", &ctx("-resized", "png")),
            "photo-resized.png"
        );
        assert_eq!(
            output_file_name("{name}{suffix}", &ctx("-watermarked", "jpg")),
            "photo-watermarked.jpg"
        );
        assert_eq!(
            output_file_name("{name}{suffix}", &ctx("-cropped", "webp")),
            "photo-cropped.webp"
        );
        assert_eq!(
            output_file_name("{name}{suffix}", &ctx("-{w}x{h}", "png")),
            "photo-590x300.png"
        );
        assert_eq!(
            output_file_name("{index}_{name}", &ctx("", "png")),
            "007_photo.png"
        );
        assert_eq!(output_file_name("", &ctx("-x", "png")), "photo-x.png");
    }

    #[test]
    fn sanitizes_dangerous_names() {
        assert_eq!(
            output_file_name("../../etc/passwd", &ctx("", "png")),
            "-..-etc-passwd.png"
        );
        assert!(!output_file_name("a/b\\c:d", &ctx("", "png")).contains(['/', '\\', ':']));
        assert_eq!(sanitize_component("..."), "image");
        assert_eq!(sanitize_component("  .hidden "), "hidden");
        assert_eq!(sanitize_component("a\u{0}b"), "a-b");
        assert!(sanitize_component(&"x".repeat(1000)).len() <= 200);
    }

    #[test]
    fn relative_dirs_cannot_escape() {
        assert_eq!(
            safe_relative_dir(Path::new("a/b")),
            Some(PathBuf::from("a/b"))
        );
        assert_eq!(
            safe_relative_dir(Path::new("./a")),
            Some(PathBuf::from("a"))
        );
        assert_eq!(safe_relative_dir(Path::new("../a")), None);
        assert_eq!(safe_relative_dir(Path::new("/abs")), None);
        assert_eq!(safe_relative_dir(Path::new("")), Some(PathBuf::new()));
    }

    #[test]
    fn collision_renaming() {
        let taken: HashSet<PathBuf> = ["/o/p.png", "/o/p-1.png"]
            .iter()
            .map(PathBuf::from)
            .collect();
        let got = next_available(Path::new("/o/p.png"), |p| taken.contains(p));
        assert_eq!(got, PathBuf::from("/o/p-2.png"));
        let got = next_available(Path::new("/o/q.png"), |p| taken.contains(p));
        assert_eq!(got, PathBuf::from("/o/q.png"));
    }
}
