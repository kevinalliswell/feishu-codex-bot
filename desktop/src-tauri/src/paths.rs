use std::fs;
use std::path::{Component, Path, PathBuf};

pub fn canonicalize_authorized_directory(path: &str) -> Result<PathBuf, String> {
    let input = Path::new(path);
    if !input.is_absolute() {
        return Err("Authorized directories must use absolute paths".into());
    }
    let canonical = fs::canonicalize(input)
        .map_err(|error| format!("Cannot access authorized directory: {error}"))?;
    if !canonical.is_dir() {
        return Err("Authorized path must be a directory".into());
    }
    Ok(canonical)
}

pub fn resolve_note_path(
    vault: &str,
    relative_dir: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name == "." || file_name == ".."
    {
        return Err("Invalid note file name".into());
    }
    let relative = Path::new(relative_dir);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Note directory must stay inside the Obsidian Vault".into());
    }

    let canonical_vault = canonicalize_authorized_directory(vault)?;
    let target_dir = canonical_vault.join(relative);
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Cannot create note directory: {error}"))?;
    let canonical_target = fs::canonicalize(&target_dir)
        .map_err(|error| format!("Cannot resolve note directory: {error}"))?;
    if !canonical_target.starts_with(&canonical_vault) {
        return Err("Note directory escapes the authorized Obsidian Vault".into());
    }
    Ok(canonical_target.join(file_name))
}
