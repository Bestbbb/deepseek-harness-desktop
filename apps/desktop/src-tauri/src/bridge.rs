//! Private authenticated RPC from the TypeScript runtime into the native host.

use serde::Deserialize;
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const TOKEN_HEADER: &str = "x-dsh-desktop-bridge-token";
const MAX_BODY_BYTES: u64 = 64 * 1024;

pub struct DesktopBridge {
    pub url: String,
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

impl DesktopBridge {
    pub fn start(app: AppHandle, token: String) -> Result<Self, String> {
        let server = Server::http("127.0.0.1:0")
            .map_err(|error| format!("Could not bind native bridge: {error}"))?;
        let url = format!("http://{}", server.server_addr());
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let join = thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                match server.recv_timeout(Duration::from_millis(100)) {
                    Ok(Some(request)) => handle_request(request, &app, &token),
                    Ok(None) => {}
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            url,
            stop,
            join: Some(join),
        })
    }

    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl Drop for DesktopBridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationRequest {
    title: String,
    body: String,
}

#[derive(Deserialize)]
struct AutostartRequest {
    enabled: bool,
}

fn handle_request(mut request: Request, app: &AppHandle, token: &str) {
    if !authenticated(&request, token) {
        respond(
            request,
            StatusCode(403),
            r#"{"ok":false,"error":"forbidden"}"#,
        );
        return;
    }
    let path = request.url().split('?').next().unwrap_or(request.url());
    let result = match (request.method(), path) {
        (&Method::Get, "/v1/status") => Ok(r#"{"ok":true}"#.to_owned()),
        (&Method::Post, "/v1/show") => show_main_window(app).map(|()| r#"{"ok":true}"#.to_owned()),
        (&Method::Post, "/v1/notify") => read_json::<NotificationRequest>(&mut request)
            .and_then(|input| {
                app.notification()
                    .builder()
                    .title(input.title)
                    .body(input.body)
                    .show()
                    .map_err(|error| error.to_string())
            })
            .map(|()| r#"{"ok":true}"#.to_owned()),
        (&Method::Post, "/v1/autostart") => read_json::<AutostartRequest>(&mut request)
            .and_then(|input| {
                if input.enabled {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                }
                .map_err(|error| error.to_string())
            })
            .map(|()| r#"{"ok":true}"#.to_owned()),
        _ => {
            respond(
                request,
                StatusCode(404),
                r#"{"ok":false,"error":"not-found"}"#,
            );
            return;
        }
    };
    match result {
        Ok(body) => respond(request, StatusCode(200), &body),
        Err(error) => respond(
            request,
            StatusCode(400),
            &serde_json::json!({ "ok": false, "error": error }).to_string(),
        ),
    }
}

fn authenticated(request: &Request, expected: &str) -> bool {
    request
        .headers()
        .iter()
        .find_map(|header| {
            header
                .field
                .equiv(TOKEN_HEADER)
                .then(|| header.value.as_str())
        })
        .is_some_and(|provided| {
            provided.len() == expected.len()
                && provided.as_bytes().ct_eq(expected.as_bytes()).into()
        })
}

fn read_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut body = String::new();
    request
        .as_reader()
        .take(MAX_BODY_BYTES + 1)
        .read_to_string(&mut body)
        .map_err(|error| format!("Could not read request: {error}"))?;
    if body.len() as u64 > MAX_BODY_BYTES {
        return Err("Request body is too large".to_owned());
    }
    serde_json::from_str(&body).map_err(|error| format!("Invalid JSON request: {error}"))
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_owned())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn respond(request: Request, status: StatusCode, body: &str) {
    let content_type = Header::from_bytes("content-type", "application/json; charset=utf-8")
        .expect("static header");
    let _ = request.respond(
        Response::from_string(body)
            .with_status_code(status)
            .with_header(content_type),
    );
}
