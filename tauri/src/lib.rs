use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 清理异常退出后仍占用固定端口的旧 sidecar，不影响其他程序。
#[cfg(all(not(debug_assertions), unix))]
fn kill_stale_server() {
    use std::{path::Path, process::Command, thread, time::Duration};

    let Ok(output) = Command::new("lsof")
        .args(["-tiTCP:8642", "-sTCP:LISTEN"])
        .output()
    else {
        return;
    };

    let mut killed = false;
    for pid in String::from_utf8_lossy(&output.stdout).split_whitespace() {
        let Ok(process) = Command::new("ps")
            .args(["-p", pid, "-o", "command="])
            .output()
        else {
            continue;
        };
        let command = String::from_utf8_lossy(&process.stdout);
        let executable = command.split_whitespace().next().unwrap_or_default();
        if Path::new(executable)
            .file_name()
            .and_then(|name| name.to_str())
            != Some("omp-switch-server")
        {
            continue;
        }

        if Command::new("kill").args(["-TERM", pid]).status().is_ok() {
            killed = true;
        }
    }

    if killed {
        thread::sleep(Duration::from_millis(500));
    }
}

/// 发布版启动本地服务，并在确认服务已成功监听后交给应用生命周期管理。
#[cfg(not(debug_assertions))]
fn spawn_server(app: &tauri::App) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    use tauri_plugin_shell::process::CommandEvent;
    use tauri_plugin_shell::ShellExt;
    #[cfg(unix)]
    kill_stale_server();

    let cmd = app
        .shell()
        .sidecar("omp-switch-server")
        .map_err(|e| format!("sidecar not found: {e}"))?;
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    let ready = std::thread::spawn(move || {
        let mut stderr = Vec::new();
        loop {
            match rx.blocking_recv() {
                Some(CommandEvent::Stdout(line)) => {
                    if String::from_utf8_lossy(&line).contains("OMP_SWITCH_READY") {
                        return Ok(());
                    }
                }
                Some(CommandEvent::Stderr(line)) => {
                    let line = String::from_utf8_lossy(&line).trim().to_string();
                    if !line.is_empty() {
                        stderr.push(line);
                    }
                }
                Some(CommandEvent::Error(error)) => {
                    return Err(format!("sidecar startup failed: {error}"));
                }
                Some(CommandEvent::Terminated(payload)) => {
                    let detail = stderr
                        .iter()
                        .find(|line| line.starts_with("error:"))
                        .or_else(|| stderr.last())
                        .cloned()
                        .unwrap_or_else(|| {
                            format!("code: {:?}, signal: {:?}", payload.code, payload.signal)
                        });
                    return Err(format!("sidecar exited before ready: {detail}"));
                }
                None => return Err("sidecar event channel closed before ready".to_string()),
                _ => {}
            }
        }
    })
    .join()
    .map_err(|_| "sidecar readiness check panicked".to_string())?;

    if let Err(error) = ready {
        let _ = child.kill();
        return Err(error);
    }
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> =
        Arc::new(Mutex::new(None));
    let server_child_for_setup = Arc::clone(&server_child);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            #[cfg(not(debug_assertions))]
            {
                let child = spawn_server(app).map_err(std::io::Error::other)?;
                *server_child_for_setup
                    .lock()
                    .map_err(|_| std::io::Error::other("sidecar 状态锁已损坏"))? = Some(child);
            }

            #[cfg(debug_assertions)]
            let _ = &server_child_for_setup;

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

    app.run(move |_app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            if let Ok(mut child) = server_child.lock() {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
