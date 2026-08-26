use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use chrono::Utc;
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_opener::OpenerExt;

use crate::approval::{ApprovalDecision, PendingApproval};
use crate::config::{AppConfig, validate_config};
use crate::legacy::{LegacyPreview, build_import, parse_env};
use crate::model::{MODEL_NAME, MODEL_SHA256, MODEL_SIZE, download_default_model, verify_sha256};
use crate::paths::{canonicalize_authorized_directory, resolve_note_path};
use crate::secrets::{SecretKind, SecretStatus};
use crate::sidecar::{BootstrapPaths, BootstrapSecrets};
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: String,
    pub message: String,
    pub sidecar_running: bool,
    pub feishu_connected: bool,
    pub model_ready: bool,
    pub queue_depth: usize,
    pub today_note_path: String,
    pub version: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub config: AppConfig,
    pub secrets: SecretStatus,
    pub status: RuntimeStatus,
    pub approvals: Vec<PendingApproval>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Serialize)]
pub struct DiagnosticResult {
    pub ok: bool,
    pub checks: Vec<DiagnosticCheck>,
}

#[derive(Deserialize)]
struct FeishuTokenResponse {
    code: i64,
    msg: String,
    tenant_access_token: Option<String>,
}

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<DesktopSnapshot, String> {
    let config = state.config.load()?;
    snapshot(&state, config)
}

#[tauri::command]
pub fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mut config: AppConfig,
) -> Result<AppConfig, String> {
    canonicalize_config_paths(&mut config)?;
    if config.onboarding_complete {
        validate_ready_config(&config, &state.secrets)?;
    }
    let autostart = app.autolaunch();
    if config.onboarding_complete && config.launch_at_login {
        autostart.enable().map_err(|error| error.to_string())?;
    } else if !config.launch_at_login {
        autostart.disable().map_err(|error| error.to_string())?;
    }
    state.config.save(&config)?;
    Ok(config)
}

#[tauri::command]
pub fn set_secret(state: State<'_, AppState>, kind: String, value: String) -> Result<(), String> {
    state.secrets.set(SecretKind::parse(&kind)?, &value)
}

#[tauri::command]
pub fn delete_secret(state: State<'_, AppState>, kind: String) -> Result<(), String> {
    state.secrets.delete(SecretKind::parse(&kind)?)
}

#[tauri::command]
pub async fn test_feishu(state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.load()?;
    let secret = state
        .secrets
        .get(SecretKind::FeishuAppSecret)?
        .ok_or("Feishu App Secret is not configured")?;
    if config.feishu.app_id.is_empty() {
        return Err("Feishu App ID is not configured".into());
    }
    let response = reqwest::Client::new()
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&json!({ "app_id": config.feishu.app_id, "app_secret": secret }))
        .send()
        .await
        .map_err(|error| format!("Cannot reach Feishu: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Feishu returned HTTP {}", response.status()));
    }
    let result: FeishuTokenResponse = response
        .json()
        .await
        .map_err(|_| "Feishu returned an invalid response".to_string())?;
    if result.code != 0
        || result
            .tenant_access_token
            .as_deref()
            .unwrap_or_default()
            .is_empty()
    {
        return Err(format!("Feishu rejected the credentials: {}", result.msg));
    }
    Ok(())
}

#[tauri::command]
pub async fn download_model(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let emitter = app.clone();
    let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
    let path = download_default_model(&state.paths.models_dir, move |progress| {
        if progress.state != "downloading"
            || last_emit.elapsed() >= std::time::Duration::from_millis(250)
        {
            let _ = emitter.emit("model-progress", progress);
            last_emit = std::time::Instant::now();
        }
    })
    .await?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn restart_sidecar(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut config = state.config.load()?;
    validate_ready_config(&config, &state.secrets)?;
    config.paused = false;
    state.config.save(&config)?;
    start_sidecar(&app, &state, &config).await
}

#[tauri::command]
pub async fn set_paused(
    app: AppHandle,
    state: State<'_, AppState>,
    paused: bool,
) -> Result<(), String> {
    let mut config = state.config.load()?;
    config.paused = paused;
    state.config.save(&config)?;
    if paused {
        state.sidecar.mark_paused(true);
        state.sidecar.stop().await
    } else {
        validate_ready_config(&config, &state.secrets)?;
        start_sidecar(&app, &state, &config).await
    }
}

#[tauri::command]
pub fn resolve_approval(
    state: State<'_, AppState>,
    id: String,
    approved: bool,
) -> Result<(), String> {
    let decision = state
        .approvals
        .lock()
        .map_err(|_| "Approval state is unavailable")?
        .resolve(&id, approved, SystemTime::now());
    let send_approved = matches!(decision, ApprovalDecision::Approved);
    if !matches!(decision, ApprovalDecision::Missing) {
        state.sidecar.send(json!({
            "version": 1,
            "id": uuid::Uuid::new_v4().to_string(),
            "type": "resolveApproval",
            "payload": { "id": id, "approved": send_approved }
        }))?;
    }
    match decision {
        ApprovalDecision::Approved | ApprovalDecision::Rejected => Ok(()),
        ApprovalDecision::Expired => Err("Approval expired after five minutes".into()),
        ApprovalDecision::Missing => Err("Approval was already handled or does not exist".into()),
    }
}

#[tauri::command]
pub fn run_diagnostics(state: State<'_, AppState>) -> Result<DiagnosticResult, String> {
    build_diagnostics(&state)
}

#[tauri::command]
pub fn export_diagnostics(
    state: State<'_, AppState>,
    destination: String,
) -> Result<String, String> {
    let destination = PathBuf::from(destination);
    if !destination.is_absolute() {
        return Err("Diagnostic export path must be absolute".into());
    }
    let parent = destination
        .parent()
        .ok_or("Diagnostic export has no parent")?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Cannot access diagnostic export directory: {error}"))?;
    let file_name = destination
        .file_name()
        .ok_or("Diagnostic export needs a file name")?;
    let destination = canonical_parent.join(file_name);
    let report = build_diagnostics(&state)?;
    let payload = json!({
        "generatedAt": Utc::now().to_rfc3339(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "diagnostics": report
    });
    let temporary = canonical_parent.join(format!(
        ".feishu-codex-diagnostics-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut file, &payload).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

fn build_diagnostics(state: &AppState) -> Result<DiagnosticResult, String> {
    let config = state.config.load()?;
    let mut checks = Vec::new();
    let config_errors = validate_config(&config);
    checks.push(check(
        "配置文件",
        config_errors.is_empty(),
        if config_errors.is_empty() {
            "schema v1 有效".into()
        } else {
            config_errors.join("；")
        },
    ));
    let secret_status = state.secrets.status()?;
    checks.push(check(
        "macOS 钥匙串",
        secret_status.feishu_app_secret,
        if secret_status.feishu_app_secret {
            "飞书密钥已配置"
        } else {
            "缺少飞书 App Secret"
        },
    ));
    let model_path = state.paths.models_dir.join(MODEL_NAME);
    let model_ok = model_path.exists() && verify_sha256(&model_path, MODEL_SHA256).unwrap_or(false);
    checks.push(check(
        "Whisper 模型",
        model_ok,
        if model_ok {
            "大小与 SHA-256 校验通过"
        } else {
            "模型缺失或校验失败"
        },
    ));
    let vault_result = probe_vault(&config);
    checks.push(check(
        "Obsidian 写入",
        vault_result.is_ok(),
        vault_result.unwrap_or_else(|error| error),
    ));
    checks.push(check(
        "Sidecar",
        state.sidecar.is_running(),
        if state.sidecar.is_running() {
            "独立服务正在运行"
        } else {
            "独立服务未运行"
        },
    ));
    let ok = checks.iter().all(|item| item.ok);
    Ok(DiagnosticResult { ok, checks })
}

#[tauri::command]
pub fn open_today_note(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.load()?;
    let path = today_note_path(&config)?;
    if !path.exists() {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|error| format!("Cannot create today's note: {error}"))?;
        let date = path
            .file_stem()
            .and_then(|part| part.to_str())
            .unwrap_or("今日");
        writeln!(file, "# 每日口述 {date}\n").map_err(|error| error.to_string())?;
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn inspect_legacy(
    state: State<'_, AppState>,
    source_path: Option<String>,
) -> Result<LegacyPreview, String> {
    let launch_agent = legacy_launch_agent_path();
    let selected = source_path
        .map(PathBuf::from)
        .or_else(|| discover_legacy_env(&launch_agent));
    let Some(path) = selected else {
        return Ok(LegacyPreview {
            launch_agent_found: launch_agent.exists(),
            ..LegacyPreview::default()
        });
    };
    let contents =
        fs::read_to_string(&path).map_err(|error| format!("Cannot read legacy .env: {error}"))?;
    let imported = build_import(&parse_env(&contents)?);
    let _ = state;
    Ok(LegacyPreview {
        found: true,
        source_path: path.to_string_lossy().into_owned(),
        app_id: imported.config.feishu.app_id,
        vault_path: imported.config.obsidian.vault_path,
        relative_dir: imported.config.obsidian.relative_dir,
        allowed_chat_ids: imported.config.feishu.allowed_chat_ids,
        has_feishu_secret: imported.feishu_secret.is_some(),
        has_assistant_api_key: imported.assistant_api_key.is_some(),
        has_image_api_key: imported.image_api_key.is_some(),
        launch_agent_found: launch_agent.exists(),
    })
}

#[tauri::command]
pub fn import_legacy(state: State<'_, AppState>, source_path: String) -> Result<AppConfig, String> {
    let source = fs::canonicalize(&source_path)
        .map_err(|error| format!("Cannot access legacy .env: {error}"))?;
    if !source.is_file() {
        return Err("Legacy source must be a regular file".into());
    }
    let contents = fs::read_to_string(&source).map_err(|error| error.to_string())?;
    let mut imported = build_import(&parse_env(&contents)?);
    canonicalize_config_paths(&mut imported.config)?;
    if let Some(secret) = imported.feishu_secret.as_deref() {
        state.secrets.set(SecretKind::FeishuAppSecret, secret)?;
    }
    if let Some(secret) = imported.assistant_api_key.as_deref() {
        state.secrets.set(SecretKind::AssistantApiKey, secret)?;
    }
    if let Some(secret) = imported.image_api_key.as_deref() {
        state.secrets.set(SecretKind::ImageApiKey, secret)?;
    }
    state.config.save(&imported.config)?;
    let backup_dir = state.paths.data_dir.join("migration");
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    fs::set_permissions(&backup_dir, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;
    let backup = backup_dir.join("legacy.env.backup");
    let mut output = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(backup)
        .map_err(|error| error.to_string())?;
    output
        .write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    output.sync_all().map_err(|error| error.to_string())?;
    Ok(imported.config)
}

#[tauri::command]
pub fn disable_legacy_service() -> Result<(), String> {
    let launch_agent = legacy_launch_agent_path();
    if !launch_agent.exists() {
        return Ok(());
    }
    let output = Command::new("/bin/launchctl")
        .arg("unload")
        .arg(&launch_agent)
        .output()
        .map_err(|error| format!("Cannot stop legacy service: {error}"))?;
    if !output.status.success() {
        return Err("macOS could not stop the legacy service".into());
    }
    Ok(())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        app.restart();
    });
    Ok(())
}

pub async fn start_if_ready(app: AppHandle) {
    let state = app.state::<AppState>();
    let Ok(config) = state.config.load() else {
        return;
    };
    if config.onboarding_complete
        && !config.paused
        && validate_ready_config(&config, &state.secrets).is_ok()
    {
        let _ = start_sidecar(&app, &state, &config).await;
    }
}

fn snapshot(state: &AppState, config: AppConfig) -> Result<DesktopSnapshot, String> {
    let sidecar = state.sidecar.status();
    let model_ready = fs::metadata(state.paths.models_dir.join(MODEL_NAME))
        .map(|metadata| metadata.len() == MODEL_SIZE)
        .unwrap_or(false);
    let today_note_path = display_today_note_path(&config);
    Ok(DesktopSnapshot {
        secrets: state.secrets.status()?,
        status: RuntimeStatus {
            state: sidecar.state.clone(),
            message: sidecar.message,
            sidecar_running: sidecar.running,
            feishu_connected: sidecar.running && sidecar.state == "connected",
            model_ready,
            queue_depth: queue_depth(&state.paths.data_dir.join("voice-note-jobs")),
            today_note_path,
            version: env!("CARGO_PKG_VERSION"),
        },
        approvals: state
            .approvals
            .lock()
            .map_err(|_| "Approval state is unavailable")?
            .list(SystemTime::now()),
        config,
    })
}

fn validate_ready_config(
    config: &AppConfig,
    secrets: &crate::secrets::KeychainStore,
) -> Result<(), String> {
    let mut errors = validate_config(config);
    if config.feishu.app_id.is_empty() {
        errors.push("Feishu App ID is required".into());
    }
    if config.feishu.allowed_chat_ids.is_empty() {
        errors.push("At least one allowed Feishu chat is required".into());
    }
    if config.obsidian.vault_path.is_empty() {
        errors.push("Obsidian Vault is required".into());
    }
    if secrets.get(SecretKind::FeishuAppSecret)?.is_none() {
        errors.push("Feishu App Secret is required".into());
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(())
}

fn canonicalize_config_paths(config: &mut AppConfig) -> Result<(), String> {
    if !config.obsidian.vault_path.is_empty() {
        config.obsidian.vault_path =
            canonicalize_authorized_directory(&config.obsidian.vault_path)?
                .to_string_lossy()
                .into_owned();
        resolve_note_path(
            &config.obsidian.vault_path,
            &config.obsidian.relative_dir,
            ".permission-check",
        )?;
    }
    for root in &mut config.codex.roots {
        root.path = canonicalize_authorized_directory(&root.path)?
            .to_string_lossy()
            .into_owned();
        if root.access != "read" && root.access != "write" {
            return Err("Codex access must be read or write".into());
        }
    }
    let errors = validate_config(config);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

async fn start_sidecar(
    app: &AppHandle,
    state: &AppState,
    config: &AppConfig,
) -> Result<(), String> {
    let paths = BootstrapPaths {
        data_dir: state.paths.data_dir.to_string_lossy().into_owned(),
        model_path: state
            .paths
            .models_dir
            .join(MODEL_NAME)
            .to_string_lossy()
            .into_owned(),
        ffmpeg_path: bundled_tool_path(app, "ffmpeg")?,
        whisper_path: bundled_tool_path(app, "whisper-cli")?,
    };
    let secrets = BootstrapSecrets {
        feishu_app_secret: state
            .secrets
            .get(SecretKind::FeishuAppSecret)?
            .unwrap_or_default(),
        assistant_api_key: state
            .secrets
            .get(SecretKind::AssistantApiKey)?
            .unwrap_or_default(),
        image_api_key: state
            .secrets
            .get(SecretKind::ImageApiKey)?
            .unwrap_or_default(),
    };
    state
        .sidecar
        .start(
            app,
            config,
            secrets,
            paths,
            state.approvals.clone(),
            state.paths.logs_dir.join("sidecar.log"),
        )
        .await?;
    state
        .sidecar
        .wait_until_ready(std::time::Duration::from_secs(20))
        .await
}

fn bundled_tool_path(app: &AppHandle, name: &str) -> Result<String, String> {
    let triple = if cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else {
        "x86_64-apple-darwin"
    };
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let candidates = [
        executable_dir.join(name),
        resource_dir.join(name),
        resource_dir.join(format!("{name}-{triple}")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("{name}-{triple}")),
    ];
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| format!("Bundled {name} is missing"))
}

fn today_note_path(config: &AppConfig) -> Result<PathBuf, String> {
    let time_zone: Tz = config
        .obsidian
        .time_zone
        .parse()
        .map_err(|_| "Invalid note time zone")?;
    let file_name = format!(
        "{}.md",
        Utc::now().with_timezone(&time_zone).format("%Y-%m-%d")
    );
    resolve_note_path(
        &config.obsidian.vault_path,
        &config.obsidian.relative_dir,
        &file_name,
    )
}

fn display_today_note_path(config: &AppConfig) -> String {
    let Ok(time_zone) = config.obsidian.time_zone.parse::<Tz>() else {
        return String::new();
    };
    let file_name = format!(
        "{}.md",
        Utc::now().with_timezone(&time_zone).format("%Y-%m-%d")
    );
    Path::new(&config.obsidian.vault_path)
        .join(&config.obsidian.relative_dir)
        .join(file_name)
        .to_string_lossy()
        .into_owned()
}

fn probe_vault(config: &AppConfig) -> Result<String, String> {
    let file_name = format!(".feishu-codex-write-test-{}", uuid::Uuid::new_v4());
    let path = resolve_note_path(
        &config.obsidian.vault_path,
        &config.obsidian.relative_dir,
        &file_name,
    )?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| format!("Vault is not writable: {error}"))?;
    file.write_all(b"write test")
        .map_err(|error| error.to_string())?;
    fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok("授权目录可安全写入".into())
}

fn check(label: &str, ok: bool, detail: impl Into<String>) -> DiagnosticCheck {
    DiagnosticCheck {
        label: label.into(),
        ok,
        detail: detail.into(),
    }
}

fn queue_depth(path: &Path) -> usize {
    fs::read_dir(path)
        .map(|entries| entries.filter_map(Result::ok).count())
        .unwrap_or(0)
}

fn legacy_launch_agent_path() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
        .join("Library/LaunchAgents/com.kevin.feishu-codex.plist")
}

fn discover_legacy_env(launch_agent: &Path) -> Option<PathBuf> {
    let contents = fs::read_to_string(launch_agent).ok()?;
    for line in contents.lines() {
        let trimmed = line.trim();
        let Some(value) = trimmed
            .strip_prefix("<string>")
            .and_then(|value| value.strip_suffix("</string>"))
        else {
            continue;
        };
        let candidate = Path::new(value);
        if candidate.file_name().and_then(|name| name.to_str()) == Some(".env")
            && candidate.is_file()
        {
            return Some(candidate.to_path_buf());
        }
        if candidate.is_dir() && candidate.join(".env").is_file() {
            return Some(candidate.join(".env"));
        }
    }
    None
}
