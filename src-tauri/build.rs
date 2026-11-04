fn main() {
    // The image engine links Apple's Swift runtime (for the Vision bridge used by
    // background removal). It ships with macOS in /usr/lib/swift.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build()
}
