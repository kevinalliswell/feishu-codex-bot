use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

const TRAY_ID: &str = "feishu-codex-status";

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let today = MenuItem::with_id(app, "today", "打开今日笔记", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "暂停 / 继续接收", true, None::<&str>)?;
    let reconnect = MenuItem::with_id(app, "reconnect", "重新连接", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Feishu Codex", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&today, &pause, &reconnect, &settings, &separator, &quit],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(status_icon("needs-setup"))
        .tooltip("Feishu Codex · 待配置")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => show_main_window(app),
            "today" | "pause" | "reconnect" => {
                let _ = app.emit("tray-action", event.id().as_ref());
            }
            "quit" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<crate::state::AppState>() {
                        let _ = state.sidecar.stop().await;
                    }
                    app.exit(0);
                });
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn set_status_icon(app: &AppHandle, state: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(status_icon(state)));
        let label = match state {
            "connected" => "已连接",
            "busy" => "正在处理",
            "error" => "服务异常",
            "paused" => "已暂停",
            _ => "待配置",
        };
        let _ = tray.set_tooltip(Some(format!("Feishu Codex · {label}")));
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn status_icon(state: &str) -> Image<'static> {
    let color = match state {
        "connected" => [47, 142, 92, 255],
        "busy" => [215, 154, 43, 255],
        "error" => [196, 70, 61, 255],
        _ => [132, 138, 145, 255],
    };
    let size = 18_u32;
    let mut rgba = vec![0_u8; (size * size * 4) as usize];
    let center = (size as f32 - 1.0) / 2.0;
    for y in 0..size {
        for x in 0..size {
            let distance = ((x as f32 - center).powi(2) + (y as f32 - center).powi(2)).sqrt();
            if distance <= 6.5 {
                let offset = ((y * size + x) * 4) as usize;
                rgba[offset..offset + 4].copy_from_slice(&color);
            }
        }
    }
    Image::new_owned(rgba, size, size)
}
