use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, SystemTime};

use feishu_codex_desktop::{
    approval::{ApprovalDecision, ApprovalStore},
    config::{AppConfig, ConfigStore, validate_config},
    model::verify_sha256,
    secrets::SecretKind,
};
use tempfile::tempdir;

#[test]
fn default_config_exposes_modules_without_privileged_roots() {
    let config = AppConfig::default();

    assert_eq!(config.version, 1);
    assert!(config.transcription.enabled);
    assert!(config.codex.enabled);
    assert!(config.image.enabled);
    assert!(config.codex.roots.is_empty());
    assert!(!config.onboarding_complete);
}

#[test]
fn config_store_round_trips_with_owner_only_permissions() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("config.json");
    let store = ConfigStore::new(path.clone());
    let mut config = AppConfig::default();
    config.feishu.app_id = "cli_test".to_string();

    store.save(&config).expect("save config");
    let loaded = store.load().expect("load config");

    assert_eq!(loaded.feishu.app_id, "cli_test");
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn validation_rejects_relative_codex_roots_and_vault_escape() {
    let mut config = AppConfig::default();
    config.obsidian.relative_dir = "../outside".to_string();
    config.codex.roots.push(Default::default());

    let errors = validate_config(&config);

    assert!(errors.iter().any(|error| error.contains("Vault")));
    assert!(errors.iter().any(|error| error.contains("absolute")));
}

#[test]
fn write_approval_is_single_use_and_expires() {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(10_000);
    let mut approvals = ApprovalStore::default();
    let approval = approvals.request(
        "ou_requester".into(),
        "更新 README".into(),
        "/Users/example/project".into(),
        now,
    );

    assert_eq!(
        approvals.resolve(&approval.id, true, now),
        ApprovalDecision::Approved
    );
    assert_eq!(
        approvals.resolve(&approval.id, true, now),
        ApprovalDecision::Missing
    );

    let expired = approvals.request(
        "ou_requester".into(),
        "删除文件".into(),
        "/Users/example/project".into(),
        now,
    );
    assert_eq!(
        approvals.resolve(&expired.id, true, now + Duration::from_secs(301)),
        ApprovalDecision::Expired
    );
}

#[test]
fn secret_names_are_an_explicit_allowlist() {
    assert_eq!(
        SecretKind::parse("feishuAppSecret").unwrap(),
        SecretKind::FeishuAppSecret
    );
    assert!(SecretKind::parse("arbitraryShellToken").is_err());
}

#[test]
fn model_checksum_must_match_exactly() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("model.bin");
    fs::write(&path, b"model bytes").unwrap();

    assert!(
        verify_sha256(
            &path,
            "9cb7487000bc86ac36ce83c4acfabe8878552be99572a6770f65ab1d048a5c48"
        )
        .unwrap()
    );
    assert!(!verify_sha256(&path, &"0".repeat(64)).unwrap());
}
