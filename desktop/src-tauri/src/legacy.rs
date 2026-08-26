use std::collections::HashMap;

use serde::Serialize;

use crate::config::AppConfig;

const MAX_ENV_BYTES: usize = 256 * 1024;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPreview {
    pub found: bool,
    pub source_path: String,
    pub app_id: String,
    pub vault_path: String,
    pub relative_dir: String,
    pub allowed_chat_ids: Vec<String>,
    pub has_feishu_secret: bool,
    pub has_assistant_api_key: bool,
    pub has_image_api_key: bool,
    pub launch_agent_found: bool,
}

#[derive(Debug, Default)]
pub struct LegacyImport {
    pub config: AppConfig,
    pub feishu_secret: Option<String>,
    pub assistant_api_key: Option<String>,
    pub image_api_key: Option<String>,
}

pub fn parse_env(contents: &str) -> Result<HashMap<String, String>, String> {
    if contents.len() > MAX_ENV_BYTES {
        return Err("Legacy .env file is too large".into());
    }
    let mut values = HashMap::new();
    for (line_number, original) in contents.lines().enumerate() {
        let line = original.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, raw_value)) = line.split_once('=') else {
            return Err(format!("Invalid .env entry on line {}", line_number + 1));
        };
        let key = key.trim();
        if key.is_empty()
            || !key.chars().enumerate().all(|(index, character)| {
                character == '_'
                    || character.is_ascii_alphanumeric()
                        && (index > 0 || !character.is_ascii_digit())
            })
        {
            return Err(format!("Invalid .env key on line {}", line_number + 1));
        }
        let mut value = raw_value.trim().to_string();
        if value.len() >= 2 {
            let first = value.as_bytes()[0];
            let last = value.as_bytes()[value.len() - 1];
            if (first == b'\'' && last == b'\'') || (first == b'\"' && last == b'\"') {
                value = value[1..value.len() - 1].to_string();
            }
        }
        values.insert(key.to_string(), value);
    }
    Ok(values)
}

pub fn build_import(values: &HashMap<String, String>) -> LegacyImport {
    let mut config = AppConfig::default();
    config.feishu.app_id = value(values, "FEISHU_APP_ID");
    config.feishu.allowed_chat_ids = value(values, "FEISHU_ALLOWED_CHAT_IDS")
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect();
    config.obsidian.vault_path = value(values, "OBSIDIAN_VAULT_PATH");
    let relative_dir = value(values, "VOICE_NOTE_RELATIVE_DIR");
    if !relative_dir.is_empty() {
        config.obsidian.relative_dir = relative_dir;
    }
    let time_zone = value(values, "VOICE_NOTE_TIME_ZONE");
    if !time_zone.is_empty() {
        config.obsidian.time_zone = time_zone;
    }
    LegacyImport {
        config,
        feishu_secret: secret(values, "FEISHU_APP_SECRET"),
        assistant_api_key: secret(values, "OPENAI_COMPAT_API_KEY"),
        image_api_key: secret(values, "IMAGE_GENERATION_API_KEY"),
    }
}

fn value(values: &HashMap<String, String>, key: &str) -> String {
    values
        .get(key)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn secret(values: &HashMap<String, String>, key: &str) -> Option<String> {
    let value = value(values, key);
    (!value.is_empty()).then_some(value)
}
