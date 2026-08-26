use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use reqwest::header::RANGE;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub const MODEL_NAME: &str = "ggml-large-v3-turbo-q5_0.bin";
pub const MODEL_SIZE: u64 = 574_041_195;
pub const MODEL_SHA256: &str = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";
const MODEL_URLS: [&str; 2] = [
    "https://github.com/kevinalliswell/feishu-codex-bot/releases/download/models-v1/ggml-large-v3-turbo-q5_0.bin",
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub state: &'static str,
}

pub fn verify_sha256(path: &Path, expected: &str) -> Result<bool, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()).eq_ignore_ascii_case(expected))
}

pub async fn download_default_model<F>(
    models_dir: &Path,
    mut progress: F,
) -> Result<PathBuf, String>
where
    F: FnMut(ModelProgress) + Send,
{
    tokio::fs::create_dir_all(models_dir)
        .await
        .map_err(|error| error.to_string())?;
    let destination = models_dir.join(MODEL_NAME);
    if destination.exists() && verify_sha256(&destination, MODEL_SHA256)? {
        progress(ModelProgress {
            downloaded_bytes: MODEL_SIZE,
            total_bytes: MODEL_SIZE,
            state: "ready",
        });
        return Ok(destination);
    }

    let partial = models_dir.join(format!("{MODEL_NAME}.part"));
    let client = reqwest::Client::builder()
        .user_agent("Feishu-Codex/0.2")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?;

    let mut last_error = "No model download source was available".to_string();
    for url in MODEL_URLS {
        match download_from(&client, url, &partial, &mut progress).await {
            Ok(()) => {
                progress(ModelProgress {
                    downloaded_bytes: MODEL_SIZE,
                    total_bytes: MODEL_SIZE,
                    state: "verifying",
                });
                if verify_sha256(&partial, MODEL_SHA256)? {
                    tokio::fs::rename(&partial, &destination)
                        .await
                        .map_err(|error| error.to_string())?;
                    progress(ModelProgress {
                        downloaded_bytes: MODEL_SIZE,
                        total_bytes: MODEL_SIZE,
                        state: "ready",
                    });
                    return Ok(destination);
                }
                tokio::fs::remove_file(&partial).await.ok();
                last_error = "Downloaded model failed SHA-256 verification".into();
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

async fn download_from<F>(
    client: &reqwest::Client,
    url: &str,
    partial: &Path,
    progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(ModelProgress),
{
    let existing = tokio::fs::metadata(partial)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut request = client.get(url);
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Model source returned HTTP {}", response.status()));
    }
    let resumed = existing > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut downloaded = if resumed { existing } else { 0 };
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(partial)
        .await
        .map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| error.to_string())?;
        downloaded = downloaded.saturating_add(bytes.len() as u64);
        if downloaded > MODEL_SIZE {
            return Err("Model download exceeded the expected size".into());
        }
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())?;
        progress(ModelProgress {
            downloaded_bytes: downloaded,
            total_bytes: MODEL_SIZE,
            state: "downloading",
        });
    }
    file.sync_all().await.map_err(|error| error.to_string())?;
    Ok(())
}
