use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

use crate::approval::ApprovalStore;
use crate::config::AppConfig;

const MAX_PROTOCOL_BUFFER_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarState {
    pub state: String,
    pub running: bool,
    pub message: String,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            state: "needs-setup".into(),
            running: false,
            message: "完成配置后即可连接飞书".into(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapSecrets {
    pub feishu_app_secret: String,
    pub assistant_api_key: String,
    pub image_api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPaths {
    pub data_dir: String,
    pub model_path: String,
    pub ffmpeg_path: String,
    pub whisper_path: String,
}

#[derive(Default, Clone)]
pub struct SidecarManager {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: Arc<Mutex<SidecarState>>,
}

impl SidecarManager {
    pub fn status(&self) -> SidecarState {
        self.status.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        self.child.lock().unwrap().is_some()
    }

    pub fn send(&self, message: Value) -> Result<(), String> {
        let line = format!(
            "{}\n",
            serde_json::to_string(&message).map_err(|error| error.to_string())?
        );
        let mut guard = self.child.lock().unwrap();
        guard
            .as_mut()
            .ok_or("Sidecar is not running")?
            .write(line.as_bytes())
            .map_err(|error| error.to_string())
    }

    pub async fn start(
        &self,
        app: &AppHandle,
        config: &AppConfig,
        secrets: BootstrapSecrets,
        paths: BootstrapPaths,
        approvals: Arc<Mutex<ApprovalStore>>,
        log_path: PathBuf,
    ) -> Result<(), String> {
        self.stop().await?;
        let (mut receiver, child) = app
            .shell()
            .sidecar("binaries/feishu-codex-sidecar")
            .map_err(|error| error.to_string())?
            .spawn()
            .map_err(|error| error.to_string())?;
        *self.child.lock().unwrap() = Some(child);
        *self.status.lock().unwrap() = SidecarState {
            state: "busy".into(),
            running: true,
            message: "正在连接飞书".into(),
        };

        let bootstrap = json!({
            "version": 1,
            "id": uuid::Uuid::new_v4().to_string(),
            "type": "bootstrap",
            "payload": { "config": config, "secrets": secrets, "paths": paths }
        });
        self.send(bootstrap)?;

        let status = self.status.clone();
        let child_slot = self.child.clone();
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut stdout_buffer = Vec::new();
            while let Some(event) = receiver.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        match push_ndjson_frames(&mut stdout_buffer, &bytes) {
                            Ok(messages) => {
                                for message in messages {
                                    handle_protocol_message(
                                        &message,
                                        &status,
                                        &approvals,
                                        &app_handle,
                                    );
                                }
                            }
                            Err(error) => {
                                append_log(&log_path, "error", &error).await;
                                stdout_buffer.clear();
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        append_log(&log_path, "error", &String::from_utf8_lossy(&bytes)).await
                    }
                    CommandEvent::Error(error) => append_log(&log_path, "error", &error).await,
                    CommandEvent::Terminated(payload) => {
                        *child_slot.lock().unwrap() = None;
                        let mut current = status.lock().unwrap();
                        current.running = false;
                        if current.state != "paused" {
                            current.state = if payload.code == Some(0) {
                                "needs-setup".into()
                            } else {
                                "error".into()
                            };
                            current.message = if payload.code == Some(0) {
                                "桌面服务已停止".into()
                            } else {
                                "Sidecar 意外退出".into()
                            };
                        }
                        let _ = app_handle.emit("runtime-status", current.clone());
                        crate::tray::set_status_icon(&app_handle, &current.state);
                        break;
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        if self.child.lock().unwrap().is_none() {
            return Ok(());
        }
        let _ = self.send(
            json!({ "version": 1, "id": uuid::Uuid::new_v4().to_string(), "type": "shutdown" }),
        );
        for _ in 0..20 {
            if self.child.lock().unwrap().is_none() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if let Some(child) = self.child.lock().unwrap().take() {
            child.kill().map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub fn mark_paused(&self, paused: bool) {
        let mut status = self.status.lock().unwrap();
        status.state = if paused {
            "paused".into()
        } else {
            "needs-setup".into()
        };
        status.running = false;
        status.message = if paused {
            "已暂停接收飞书消息".into()
        } else {
            "正在恢复连接".into()
        };
    }
}

pub fn push_ndjson_frames(buffer: &mut Vec<u8>, chunk: &[u8]) -> Result<Vec<Value>, String> {
    if buffer.len().saturating_add(chunk.len()) > MAX_PROTOCOL_BUFFER_BYTES {
        return Err("Sidecar protocol buffer exceeded its limit".into());
    }
    buffer.extend_from_slice(chunk);
    let mut messages = Vec::new();
    while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
        let mut line: Vec<u8> = buffer.drain(..=index).collect();
        line.pop();
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        if line.is_empty() {
            continue;
        }
        let value = serde_json::from_slice::<Value>(&line)
            .map_err(|_| "Sidecar sent an invalid protocol frame".to_string())?;
        if value.get("version").and_then(Value::as_u64) != Some(1) {
            return Err("Sidecar sent an unsupported protocol version".into());
        }
        messages.push(value);
    }
    Ok(messages)
}

fn handle_protocol_message(
    message: &Value,
    status: &Arc<Mutex<SidecarState>>,
    approvals: &Arc<Mutex<ApprovalStore>>,
    app: &AppHandle,
) {
    match message.get("type").and_then(Value::as_str) {
        Some("status") => {
            let next = message
                .pointer("/payload/state")
                .and_then(Value::as_str)
                .unwrap_or("busy");
            let mut current = status.lock().unwrap();
            current.state = next.into();
            current.running = true;
            current.message = if next == "connected" {
                "飞书长连接正常，正在等待新消息".into()
            } else {
                "桌面服务正在处理".into()
            };
            let _ = app.emit("runtime-status", current.clone());
            crate::tray::set_status_icon(app, &current.state);
        }
        Some("approvalRequired") => {
            let payload = &message["payload"];
            let id = payload["id"].as_str().unwrap_or_default();
            if !id.is_empty() {
                approvals.lock().unwrap().insert_external(
                    id.into(),
                    payload["requester"]
                        .as_str()
                        .unwrap_or("未知飞书用户")
                        .into(),
                    payload["prompt"]
                        .as_str()
                        .unwrap_or("Codex 写入任务")
                        .chars()
                        .take(2_000)
                        .collect(),
                    payload["rootPath"].as_str().unwrap_or_default().into(),
                    payload["expiresAtMs"].as_u64().unwrap_or_default() as u128,
                );
                let _ = app.emit("approval-required", payload.clone());
            }
        }
        Some("log") => {
            if message.pointer("/payload/level").and_then(Value::as_str) == Some("error") {
                let mut current = status.lock().unwrap();
                current.message = message
                    .pointer("/payload/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Sidecar error")
                    .chars()
                    .take(240)
                    .collect();
            }
        }
        _ => {}
    }
}

async fn append_log(path: &PathBuf, level: &str, message: &str) {
    use tokio::io::AsyncWriteExt;
    if let Some(parent) = path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    if let Ok(mut file) = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
    {
        let clean: String = message
            .chars()
            .filter(|character| *character != '\0')
            .take(2_000)
            .collect();
        let _ = file
            .write_all(format!("[{level}] {}\n", clean.replace('\n', " ")).as_bytes())
            .await;
    }
}
