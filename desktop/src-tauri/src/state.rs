use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::approval::ApprovalStore;
use crate::config::ConfigStore;
use crate::secrets::KeychainStore;
use crate::sidecar::SidecarManager;

pub struct AppPaths {
    pub data_dir: PathBuf,
    pub models_dir: PathBuf,
    pub logs_dir: PathBuf,
}

impl AppPaths {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let logs_dir = app
            .path()
            .app_log_dir()
            .map_err(|error| error.to_string())?;
        Ok(Self {
            models_dir: data_dir.join("models"),
            data_dir,
            logs_dir,
        })
    }
}

pub struct AppState {
    pub config: ConfigStore,
    pub secrets: KeychainStore,
    pub approvals: Arc<Mutex<ApprovalStore>>,
    pub sidecar: SidecarManager,
    pub paths: AppPaths,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let paths = AppPaths::new(app)?;
        std::fs::create_dir_all(&paths.data_dir).map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&paths.models_dir).map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&paths.logs_dir).map_err(|error| error.to_string())?;
        for directory in [&paths.data_dir, &paths.models_dir, &paths.logs_dir] {
            std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|error| error.to_string())?;
        }
        Ok(Self {
            config: ConfigStore::new(paths.data_dir.join("config.json")),
            secrets: KeychainStore,
            approvals: Arc::new(Mutex::new(ApprovalStore::default())),
            sidecar: SidecarManager::default(),
            paths,
        })
    }
}
