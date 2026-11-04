//! On Apple platforms, compiles `swift/MacKitVision.swift` (the Apple Vision bridge
//! used for background removal) into a static library that Rust calls through a
//! C function. On other platforms nothing is built and photo-subject detection
//! reports "not supported" (logo/graphics keying and the brush still work).
//!
//! * macOS: needs the Xcode Command Line Tools (`xcode-select --install`).
//! * iOS (device or Simulator): needs full Xcode selected with `xcode-select -s`.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=swift/MacKitVision.swift");
    println!("cargo:rerun-if-changed=build.rs");
    let os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if os != "macos" && os != "ios" {
        return;
    }

    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("unsupported Apple architecture: {other}"),
    };
    let simulator = os == "ios"
        && (env::var("CARGO_CFG_TARGET_ABI").as_deref() == Ok("sim") || arch == "x86_64");
    // Deployment targets match the app (tauri.conf.json / gen/apple/project.yml).
    let (sdk_name, swift_target) = match (os.as_str(), simulator) {
        ("macos", _) => ("macosx", format!("{arch}-apple-macosx11.0")),
        (_, false) => ("iphoneos", format!("{arch}-apple-ios15.0")),
        (_, true) => ("iphonesimulator", format!("{arch}-apple-ios15.0-simulator")),
    };

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("swift/MacKitVision.swift");
    let lib = out_dir.join("libmackitvision.a");

    let sdk = xcrun(&["--sdk", sdk_name, "--show-sdk-path"], sdk_name);
    let status = Command::new("xcrun")
        .args(["--sdk", sdk_name, "swiftc"])
        .args(["-emit-library", "-static", "-parse-as-library", "-O"])
        .args(["-module-name", "MacKitVision"])
        .args(["-target", &swift_target, "-sdk", &sdk])
        .arg("-o")
        .arg(&lib)
        .arg(&source)
        // Xcode's build environment can point SDKROOT at another platform.
        .env_remove("SDKROOT")
        .status()
        .unwrap_or_else(|e| panic!("could not run swiftc ({e}). {}", setup_hint(sdk_name)));
    assert!(
        status.success(),
        "swiftc failed to compile MacKitVision.swift for {swift_target}"
    );

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=mackitvision");
    for fw in ["Vision", "CoreVideo", "CoreGraphics", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }

    // Swift runtime: the SDK's .tbd stubs plus the toolchain's compatibility
    // libraries (referenced automatically by the compiled Swift objects). On iOS
    // the final link is done by Xcode, whose project already has these paths.
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    let swiftc = xcrun(&["--sdk", sdk_name, "-f", "swiftc"], sdk_name);
    if let Some(toolchain) = Path::new(&swiftc).parent().and_then(Path::parent) {
        let compat = toolchain.join("lib/swift").join(sdk_name);
        if compat.is_dir() {
            println!("cargo:rustc-link-search=native={}", compat.display());
        }
    }
    if os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}

fn setup_hint(sdk: &str) -> &'static str {
    if sdk == "macosx" {
        "Install the Xcode Command Line Tools with `xcode-select --install`."
    } else {
        "iOS builds need full Xcode: install it from the App Store, then run \
         `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`."
    }
}

fn xcrun(args: &[&str], sdk: &str) -> String {
    let out = Command::new("xcrun")
        .args(args)
        .env_remove("SDKROOT")
        .output()
        .unwrap_or_else(|e| panic!("could not run xcrun ({e}). {}", setup_hint(sdk)));
    assert!(
        out.status.success(),
        "xcrun {args:?} failed: {}. {}",
        String::from_utf8_lossy(&out.stderr).trim(),
        setup_hint(sdk)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}
