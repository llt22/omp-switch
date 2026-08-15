use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 清理占用 8642 端口的旧 sidecar 进程
fn kill_stale_server() {
    use std::process::Command;
    if let Ok(output) = Command::new("lsof")
        .args(["-ti", ":8642"])
        .output()
    {
        let pids = String::from_utf8_lossy(&output.stdout);
        for pid in pids.split_whitespace() {
            if let Ok(pid_num) = pid.parse::<i32>() {
                unsafe { libc::kill(pid_num, libc::SIGTERM); }
            }
        }
        if !pids.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }
}

/// 启动本地服务（sidecar），失败时窗口仍可用（复用已在运行的服务）
fn spawn_server(app: &tauri::App) -> Option<tauri_plugin_shell::process::CommandChild> {
    use tauri_plugin_shell::ShellExt;
    match app.shell().sidecar("omp-switch-server") {
        Ok(cmd) => match cmd.spawn() {
            Ok((_rx, child)) => Some(child),
            Err(e) => {
                eprintln!("sidecar spawn failed: {e}（可能已有服务在运行，直接复用）");
                None
            }
        },
        Err(e) => {
            eprintln!("sidecar not found: {e}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 清理旧版 sidecar 后再启动新的
            kill_stale_server();
            let _server = spawn_server(app);

            // 系统托盘：显示窗口 / 退出
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("OMP Switch")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口 → 隐藏到托盘（服务保持运行）
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            // 托盘退出时，由系统回收 sidecar 子进程
        }
    });
}
