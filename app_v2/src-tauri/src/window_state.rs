//! Exact main-window state for the temporary screenshot overlay.
//!
//! In particular, a maximized window's current rectangle is not its restore
//! rectangle. Windows already maintains both in WINDOWPLACEMENT; keep that
//! instead of guessing whether a window is "too big" using the primary screen.

#[derive(Clone)]
pub(crate) struct MainWindowState {
    #[cfg(not(target_os = "windows"))]
    position: tauri::PhysicalPosition<i32>,
    #[cfg(not(target_os = "windows"))]
    size: tauri::PhysicalSize<u32>,
    fullscreen: bool,
    #[cfg(not(target_os = "windows"))]
    maximized: bool,
    #[cfg(not(target_os = "windows"))]
    minimized: bool,
    always_on_top: bool,
    resizable: bool,
    #[cfg(target_os = "windows")]
    placement: windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT,
}

impl MainWindowState {
    pub(crate) fn capture(window: &tauri::WebviewWindow) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        let placement = {
            use windows::Win32::Foundation::HWND;
            let hwnd = window.hwnd().map_err(|e| e.to_string())?;
            read_placement(HWND(hwnd.0 as _))?
        };
        Ok(Self {
            #[cfg(not(target_os = "windows"))]
            position: window.outer_position().map_err(|e| e.to_string())?,
            #[cfg(not(target_os = "windows"))]
            size: window.inner_size().map_err(|e| e.to_string())?,
            fullscreen: window.is_fullscreen().map_err(|e| e.to_string())?,
            #[cfg(not(target_os = "windows"))]
            maximized: window.is_maximized().map_err(|e| e.to_string())?,
            #[cfg(not(target_os = "windows"))]
            minimized: window.is_minimized().map_err(|e| e.to_string())?,
            always_on_top: window.is_always_on_top().map_err(|e| e.to_string())?,
            resizable: window.is_resizable().map_err(|e| e.to_string())?,
            #[cfg(target_os = "windows")]
            placement,
        })
    }

    pub(crate) async fn restore(
        &self,
        window: &tauri::WebviewWindow,
        show_main: bool,
    ) -> Result<(), String> {
        // Run the entire transition on the owning UI thread. Moving between
        // monitors can synchronously change DPI; resize only after that move.
        let snapshot = self.clone();
        let restore_window = window.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        window.run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let w = &restore_window;
                w.hide().map_err(|e| e.to_string())?;
                w.set_fullscreen(false).map_err(|e| e.to_string())?;
                w.unmaximize().map_err(|e| e.to_string())?;
                w.set_resizable(snapshot.resizable).map_err(|e| e.to_string())?;
                w.set_always_on_top(snapshot.always_on_top).map_err(|e| e.to_string())?;

                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    let hwnd = w.hwnd().map_err(|e| e.to_string())?;
                    restore_placement(HWND(hwnd.0 as _), snapshot.placement, show_main)?;
                }
                #[cfg(not(target_os = "windows"))]
                {
                    w.set_position(snapshot.position).map_err(|e| e.to_string())?;
                    w.set_size(snapshot.size).map_err(|e| e.to_string())?;
                    if snapshot.maximized { w.maximize().map_err(|e| e.to_string())?; }
                    if snapshot.minimized && !show_main {
                        w.minimize().map_err(|e| e.to_string())?;
                    }
                }

                if snapshot.fullscreen { w.set_fullscreen(true).map_err(|e| e.to_string())?; }
                if show_main {
                    w.show().map_err(|e| e.to_string())?;
                    w.unminimize().map_err(|e| e.to_string())?;
                    w.set_focus().map_err(|e| e.to_string())?;
                } else {
                    w.hide().map_err(|e| e.to_string())?;
                }
                Ok(())
            })();
            let _ = send.send(result);
        }).map_err(|e| e.to_string())?;
        receive.await.map_err(|e| e.to_string())?
    }
}

#[cfg(target_os = "windows")]
fn read_placement(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT, String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT};
    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    unsafe { GetWindowPlacement(hwnd, &mut placement) }.map_err(|e| e.to_string())?;
    Ok(placement)
}

#[cfg(target_os = "windows")]
fn restore_placement(
    hwnd: windows::Win32::Foundation::HWND,
    placement: windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT,
    show_main: bool,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPlacement, ShowWindow,
        GWL_EXSTYLE, SW_HIDE, WS_EX_NOACTIVATE,
    };
    // SetWindowPlacement restores the normal rectangle as well as minimized /
    // maximized state. Keep its show command intact: replacing it with SW_HIDE
    // discards the maximized state of a window that was hidden in the tray.
    // The immediate hide runs in the same UI turn, before React can repaint.
    unsafe {
        let previous_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // Restoring a tray window must not take focus from the user's editor or
        // game, even though Windows needs its original show command to retain
        // maximized/minimized state.
        if !show_main {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, previous_style | WS_EX_NOACTIVATE.0 as isize);
        }
        let result = SetWindowPlacement(hwnd, &placement).map_err(|e| e.to_string());
        if !show_main { let _ = ShowWindow(hwnd, SW_HIDE); }
        if !show_main { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, previous_style); }
        result?;
    }
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use windows::{core::w, Win32::{Foundation::HWND, UI::WindowsAndMessaging::*}};

    #[test]
    fn native_restore_keeps_full_height_and_negative_origin_geometry_and_is_repeatable() {
        // An independent native window exercises real Windows placement, with
        // no Tauri runtime, model download, network, or visible interactive UI.
        unsafe {
            for (x, y, width, height) in [
                (0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)),
                (-100, 80, 1300, 900),
            ] {
                let hwnd = CreateWindowExW(
                    WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("STATIC"), w!("Catwalk window regression"),
                    WS_POPUP, x, y, width, height, None, None, None, None,
                ).unwrap();
                struct Cleanup(HWND);
                impl Drop for Cleanup { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
                let _cleanup = Cleanup(hwnd);
                let before = read_placement(hwnd).unwrap();
                for _ in 0..3 {
                    SetWindowPos(hwnd, None, 0, 0, 3000, 1500, SWP_NOZORDER | SWP_NOACTIVATE).unwrap();
                    restore_placement(hwnd, before, false).unwrap();
                    let after = read_placement(hwnd).unwrap();
                    assert_eq!(after.rcNormalPosition, before.rcNormalPosition);
                    assert!(!IsWindowVisible(hwnd).as_bool());
                }
            }
        }
    }

    #[test]
    fn native_restore_retains_maximized_and_minimized_state_without_showing_window() {
        unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("STATIC"), w!("Catwalk state regression"),
                WS_POPUP, 200, 200, 900, 650, None, None, None, None,
            ).unwrap();
            struct Cleanup(HWND);
            impl Drop for Cleanup { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.0); } } }
            let _cleanup = Cleanup(hwnd);
            let normal = read_placement(hwnd).unwrap();
            for show in [SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED] {
                let mut before = normal;
                before.showCmd = show.0 as u32;
                SetWindowPlacement(hwnd, &before).unwrap();
                let _ = ShowWindow(hwnd, SW_HIDE);
                let before = read_placement(hwnd).unwrap();
                let was_maximized = IsZoomed(hwnd).as_bool();
                let was_minimized = IsIconic(hwnd).as_bool();
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = ShowWindow(hwnd, SW_HIDE);
                SetWindowPos(hwnd, None, 0, 0, 3000, 1500, SWP_NOZORDER | SWP_NOACTIVATE).unwrap();
                restore_placement(hwnd, before, false).unwrap();
                assert_eq!(IsZoomed(hwnd).as_bool(), was_maximized);
                assert_eq!(IsIconic(hwnd).as_bool(), was_minimized);
                assert_eq!(read_placement(hwnd).unwrap().rcNormalPosition, before.rcNormalPosition);
                assert!(!IsWindowVisible(hwnd).as_bool());
            }
        }
    }
}
