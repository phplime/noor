//! Getting Studio exports out of Noor on iPhone:
//! * **Save to Photos** — `UIImageWriteToSavedPhotosAlbum` (asks for "Add Photos" permission once).
//! * **Save to Files / Share** — the system share sheet (`UIActivityViewController`), which offers
//!   "Save to Files", "Save Image", AirDrop, WhatsApp …
//!
//! Exports are always written first to Noor's own folder (Files › On My iPhone › Noor);
//! these commands copy them onwards. Other platforms return an error.

use tauri::AppHandle;

fn check_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("Nothing to save".into());
    }
    if paths.len() > 100 {
        return Err("Up to 100 files at a time".into());
    }
    for p in paths {
        if !std::path::Path::new(p).is_file() {
            return Err(format!("File not found: {p}"));
        }
    }
    Ok(())
}

/// Run `f` on the main (UI) thread and wait for its answer.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub(crate) fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(30)).map_err(|_| "The iPhone did not answer in time".to_string())
}

/// Save images to the Photos library. Returns how many were handed to Photos.
#[tauri::command]
pub async fn save_to_photos(app: AppHandle, paths: Vec<String>) -> Result<usize, String> {
    check_paths(&paths)?;
    #[cfg(target_os = "ios")]
    {
        return on_main(&app, move || imp::save_to_photos(&paths))?;
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("Save to Photos is available on iPhone".into())
    }
}

/// Open the share sheet for these files ("Save to Files", AirDrop, …).
#[tauri::command]
pub async fn share_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    check_paths(&paths)?;
    #[cfg(target_os = "ios")]
    {
        return on_main(&app, move || imp::share(&paths))?;
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("Sharing is available on iPhone".into())
    }
}

#[cfg(target_os = "ios")]
mod imp {
    use block2::Block;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject, Sel};
    use objc2::msg_send;
    use objc2_foundation::{NSArray, NSString, NSURL};
    use std::ffi::{c_void, CStr};

    #[link(name = "UIKit", kind = "framework")]
    extern "C" {
        fn UIImageWriteToSavedPhotosAlbum(image: *mut AnyObject, target: *mut AnyObject, selector: Option<Sel>, context: *mut c_void);
    }

    // Make sure the Photos framework (PHPhotoLibrary) is linked.
    #[link(name = "Photos", kind = "framework")]
    extern "C" {}

    fn class(name: &CStr) -> Result<&'static AnyClass, String> {
        AnyClass::get(name).ok_or_else(|| format!("{} is not available", name.to_string_lossy()))
    }

    /// PHAuthorizationStatus for "add only" access: 0 not determined, 1 restricted, 2 denied, 3 authorized, 4 limited.
    fn photos_add_status() -> isize {
        let Ok(lib) = class(c"PHPhotoLibrary") else { return 0 };
        unsafe { msg_send![lib, authorizationStatusForAccessLevel: 1isize] }
    }

    pub fn save_to_photos(paths: &[String]) -> Result<usize, String> {
        if matches!(photos_add_status(), 1 | 2) {
            return Err("Noor isn't allowed to add photos. Turn it on in Settings › Noor › Photos.".into());
        }
        let ui_image = class(c"UIImage")?;
        let mut saved = 0;
        for p in paths {
            let path = NSString::from_str(p);
            let image: Option<Retained<AnyObject>> = unsafe { msg_send![ui_image, imageWithContentsOfFile: &*path] };
            let Some(image) = image else { continue };
            unsafe { UIImageWriteToSavedPhotosAlbum(Retained::as_ptr(&image) as *mut AnyObject, std::ptr::null_mut(), None, std::ptr::null_mut()) };
            saved += 1;
        }
        if saved == 0 {
            return Err("These files can't be saved as photos".into());
        }
        Ok(saved)
    }

    /// The view controller currently on screen.
    fn top_controller() -> Result<Retained<AnyObject>, String> {
        let app_cls = class(c"UIApplication")?;
        let app: Option<Retained<AnyObject>> = unsafe { msg_send![app_cls, sharedApplication] };
        let app = app.ok_or("No application")?;
        let mut window: Option<Retained<AnyObject>> = unsafe { msg_send![&*app, keyWindow] };
        if window.is_none() {
            let windows: Option<Retained<NSArray<AnyObject>>> = unsafe { msg_send![&*app, windows] };
            window = windows.and_then(|w| w.firstObject());
        }
        let window = window.ok_or("No window")?;
        let root: Option<Retained<AnyObject>> = unsafe { msg_send![&*window, rootViewController] };
        let mut top = root.ok_or("No screen to show the share sheet on")?;
        loop {
            let next: Option<Retained<AnyObject>> = unsafe { msg_send![&*top, presentedViewController] };
            match next {
                Some(n) => top = n,
                None => break,
            }
        }
        Ok(top)
    }

    pub fn share(paths: &[String]) -> Result<(), String> {
        let urls: Vec<Retained<NSURL>> = paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(p))).collect();
        let items = NSArray::from_retained_slice(&urls);
        let cls = class(c"UIActivityViewController")?;
        let alloc: Allocated<AnyObject> = unsafe { msg_send![cls, alloc] };
        let vc: Retained<AnyObject> = unsafe { msg_send![alloc, initWithActivityItems: &*items, applicationActivities: std::ptr::null_mut::<NSArray<AnyObject>>()] };
        let top = top_controller()?;
        // iPad shows the sheet as a popover, which needs an anchor.
        let pop: Option<Retained<AnyObject>> = unsafe { msg_send![&*vc, popoverPresentationController] };
        if let Some(pop) = pop {
            let view: Option<Retained<AnyObject>> = unsafe { msg_send![&*top, view] };
            if let Some(view) = view {
                let _: () = unsafe { msg_send![&*pop, setSourceView: &*view] };
            }
        }
        let done: Option<&Block<dyn Fn()>> = None;
        let _: () = unsafe { msg_send![&*top, presentViewController: &*vc, animated: true, completion: done] };
        Ok(())
    }
}
