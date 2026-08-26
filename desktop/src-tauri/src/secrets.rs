use serde::Serialize;

const KEYCHAIN_SERVICE: &str = "com.feishucodex.desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    FeishuAppSecret,
    AssistantApiKey,
    ImageApiKey,
}

impl SecretKind {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "feishuAppSecret" => Ok(Self::FeishuAppSecret),
            "assistantApiKey" => Ok(Self::AssistantApiKey),
            "imageApiKey" => Ok(Self::ImageApiKey),
            _ => Err("Unsupported secret name".into()),
        }
    }

    fn account(self) -> &'static str {
        match self {
            Self::FeishuAppSecret => "feishu-app-secret",
            Self::AssistantApiKey => "assistant-api-key",
            Self::ImageApiKey => "image-api-key",
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub feishu_app_secret: bool,
    pub assistant_api_key: bool,
    pub image_api_key: bool,
}

#[derive(Default)]
pub struct KeychainStore;

impl KeychainStore {
    fn entry(kind: SecretKind) -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, kind.account()).map_err(|error| error.to_string())
    }

    pub fn set(&self, kind: SecretKind, value: &str) -> Result<(), String> {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.len() > 8_192 {
            return Err("Secret must contain between 1 and 8192 characters".into());
        }
        Self::entry(kind)?
            .set_password(trimmed)
            .map_err(|error| error.to_string())
    }

    pub fn get(&self, kind: SecretKind) -> Result<Option<String>, String> {
        match Self::entry(kind)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn delete(&self, kind: SecretKind) -> Result<(), String> {
        match Self::entry(kind)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn status(&self) -> Result<SecretStatus, String> {
        Ok(SecretStatus {
            feishu_app_secret: self.get(SecretKind::FeishuAppSecret)?.is_some(),
            assistant_api_key: self.get(SecretKind::AssistantApiKey)?.is_some(),
            image_api_key: self.get(SecretKind::ImageApiKey)?.is_some(),
        })
    }
}
