use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u8,
    pub onboarding_complete: bool,
    pub paused: bool,
    pub launch_at_login: bool,
    pub feishu: FeishuConfig,
    pub obsidian: ObsidianConfig,
    pub transcription: TranscriptionConfig,
    pub codex: CodexConfig,
    pub image: ImageConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConfig {
    pub app_id: String,
    pub allowed_chat_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianConfig {
    pub vault_path: String,
    pub relative_dir: String,
    pub time_zone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionConfig {
    pub enabled: bool,
    pub language: String,
    pub model_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfig {
    pub enabled: bool,
    pub mode: String,
    #[serde(default = "default_codex_provider")]
    pub provider: String,
    #[serde(default = "default_codex_base_url")]
    pub base_url: String,
    #[serde(default = "default_codex_model")]
    pub model: String,
    pub roots: Vec<CodexRoot>,
}

fn default_codex_provider() -> String {
    "custom".into()
}
fn default_codex_base_url() -> String {
    "https://api.openai.com/v1".into()
}
fn default_codex_model() -> String {
    "gpt-5.4-mini".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexRoot {
    pub path: String,
    pub access: String,
}

impl Default for CodexRoot {
    fn default() -> Self {
        Self {
            path: String::new(),
            access: "read".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageConfig {
    pub enabled: bool,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub size: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            onboarding_complete: false,
            paused: false,
            launch_at_login: true,
            feishu: FeishuConfig::default(),
            obsidian: ObsidianConfig {
                vault_path: String::new(),
                relative_dir: "00_Inbox/feishu/每日口述".into(),
                time_zone: "Asia/Shanghai".into(),
            },
            transcription: TranscriptionConfig {
                enabled: true,
                language: "zh".into(),
                model_name: "ggml-large-v3-turbo-q5_0.bin".into(),
            },
            codex: CodexConfig {
                enabled: true,
                mode: "codex_exec".into(),
                provider: default_codex_provider(),
                base_url: default_codex_base_url(),
                model: default_codex_model(),
                roots: vec![],
            },
            image: ImageConfig {
                enabled: true,
                provider: "xingwan".into(),
                base_url: "https://xingwan.store/v1".into(),
                model: "gpt-image-2".into(),
                size: "1024x1024".into(),
            },
        }
    }
}

pub fn validate_config(config: &AppConfig) -> Vec<String> {
    let mut errors = Vec::new();
    let relative_path = Path::new(&config.obsidian.relative_dir);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        errors.push("Note directory must stay inside the Obsidian Vault".into());
    }
    if config
        .codex
        .roots
        .iter()
        .any(|root| !Path::new(&root.path).is_absolute())
    {
        errors.push("Codex roots must use absolute paths".into());
    }
    for (index, root) in config.codex.roots.iter().enumerate() {
        let path = Path::new(root.path.trim_end_matches('/'));
        if config.codex.roots[index + 1..].iter().any(|other| {
            let other_path = Path::new(other.path.trim_end_matches('/'));
            path.starts_with(other_path) || other_path.starts_with(path)
        }) {
            errors.push("Codex roots cannot overlap".into());
            break;
        }
    }
    if !config.feishu.app_id.is_empty() && !config.feishu.app_id.starts_with("cli_") {
        errors.push("Feishu App ID must start with cli_".into());
    }
    errors
}

pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<AppConfig, String> {
        if !self.path.exists() {
            return Ok(AppConfig::default());
        }
        let bytes = fs::read(&self.path).map_err(|error| error.to_string())?;
        serde_json::from_slice(&bytes).map_err(|error| format!("Invalid desktop config: {error}"))
    }

    pub fn save(&self, config: &AppConfig) -> Result<(), String> {
        let errors = validate_config(config);
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        let parent = self.path.parent().ok_or("Config path has no parent")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
        let temp_path = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temp_path, &self.path).map_err(|error| error.to_string())?;
        fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())
    }
}
