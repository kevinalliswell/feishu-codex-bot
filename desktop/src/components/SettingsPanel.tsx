import { useState } from "react";
import type { AppConfig } from "../types";
import type { DesktopApi, DesktopSnapshot, DiagnosticResult } from "../lib/desktop-api";

interface Props {
  section: "feishu" | "obsidian" | "transcription" | "ai" | "security" | "diagnostics";
  api: DesktopApi;
  snapshot: DesktopSnapshot;
  onChange(snapshot: DesktopSnapshot): void;
}

export function SettingsPanel({ section, api, snapshot, onChange }: Props) {
  const [draft, setDraft] = useState<AppConfig>(structuredClone(snapshot.config));
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(secretKind?: "feishuAppSecret" | "assistantApiKey" | "imageApiKey") {
    setBusy(true);
    setNotice("");
    try {
      const hasNewSecret = Boolean(secretKind && secret);
      if (secretKind && secret) await api.setSecret(secretKind, secret);
      const config = await api.saveConfig(draft);
      if (section === "feishu") await api.testFeishu();
      onChange({
        ...snapshot,
        config,
        secrets: hasNewSecret && secretKind ? { ...snapshot.secrets, [secretKind]: true } : snapshot.secrets
      });
      setSecret("");
      setNotice(section === "feishu" ? "凭据测试成功，设置已保存。" : "设置已保存，重新连接后生效。");
    } catch (reason) {
      setNotice(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  }

  async function choose(target: "vault" | "root") {
    const path = await api.chooseDirectory();
    if (!path) return;
    if (target === "vault") {
      setDraft({ ...draft, obsidian: { ...draft.obsidian, vaultPath: path } });
    } else {
      setDraft({ ...draft, codex: { ...draft.codex, roots: [{ path, access: draft.codex.roots[0]?.access || "read" }] } });
    }
  }

  if (section === "diagnostics") {
    return (
      <section className="panel settings-panel">
        <h2>诊断与更新</h2>
        <p>检查配置、钥匙串、模型、Vault 写入权限和 Sidecar。结果不会包含密钥或笔记正文。</p>
        <div className="action-row"><button className="button primary" onClick={async () => { setBusy(true); setDiagnostics(await api.runDiagnostics()); setBusy(false); }}>{busy ? "正在检查…" : "运行完整诊断"}</button><span className="version-chip">当前版本 {snapshot.status.version}</span></div>
        {diagnostics && <div className="diagnostic-list">{diagnostics.checks.map((check) => <div key={check.label}><span className={check.ok ? "check ok" : "check"}>{check.ok ? "✓" : "!"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></div>)}</div>}
      </section>
    );
  }

  return (
    <section className="panel settings-panel">
      {section === "feishu" && <FeishuFields draft={draft} setDraft={setDraft} secret={secret} setSecret={setSecret} configured={snapshot.secrets.feishuAppSecret} />}
      {section === "obsidian" && <ObsidianFields draft={draft} setDraft={setDraft} choose={() => void choose("vault")} />}
      {section === "transcription" && <TranscriptionFields draft={draft} setDraft={setDraft} modelReady={snapshot.status.modelReady} />}
      {section === "ai" && <AiFields draft={draft} setDraft={setDraft} secret={secret} setSecret={setSecret} configured={snapshot.secrets.imageApiKey} />}
      {section === "security" && <SecurityFields draft={draft} setDraft={setDraft} choose={() => void choose("root")} />}
      <button className="button primary" disabled={busy} onClick={() => void save(section === "feishu" ? "feishuAppSecret" : section === "ai" ? "imageApiKey" : undefined)}>保存设置</button>
      {notice && <p className="save-notice" role="status">{notice}</p>}
    </section>
  );
}

type FieldsProps = { draft: AppConfig; setDraft(config: AppConfig): void };

function FeishuFields({ draft, setDraft, secret, setSecret, configured }: FieldsProps & { secret: string; setSecret(value: string): void; configured: boolean }) {
  return <><h2>飞书应用</h2><p>使用企业自建应用；App Secret 只保存在 macOS 钥匙串。</p><label>App ID<input value={draft.feishu.appId} onChange={(event) => setDraft({ ...draft, feishu: { ...draft.feishu, appId: event.target.value } })} /></label><label>App Secret<input type="password" value={secret} placeholder={configured ? "已保存到钥匙串" : "尚未配置"} onChange={(event) => setSecret(event.target.value)} /></label><label>会话白名单<input value={draft.feishu.allowedChatIds.join(", ")} onChange={(event) => setDraft({ ...draft, feishu: { ...draft.feishu, allowedChatIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></label></>;
}

function ObsidianFields({ draft, setDraft, choose }: FieldsProps & { choose(): void }) {
  return <><h2>Obsidian 写入</h2><p>每日文字和语音追加到同一个 Markdown，不自动搬入长期笔记。</p><label>Vault<button className="path-picker" onClick={choose}><span>{draft.obsidian.vaultPath || "选择 Vault"}</span><strong>浏览…</strong></button></label><label>相对目录<input value={draft.obsidian.relativeDir} onChange={(event) => setDraft({ ...draft, obsidian: { ...draft.obsidian, relativeDir: event.target.value } })} /></label><label>时区<input value={draft.obsidian.timeZone} onChange={(event) => setDraft({ ...draft, obsidian: { ...draft.obsidian, timeZone: event.target.value } })} /></label></>;
}

function TranscriptionFields({ draft, setDraft, modelReady }: FieldsProps & { modelReady: boolean }) {
  return <><h2>本地语音转写</h2><p>FFmpeg 转换格式，whisper.cpp 在本机运行模型。</p><label className="toggle-row"><span><strong>启用语音笔记</strong><small>仅接收白名单私聊语音</small></span><input type="checkbox" checked={draft.transcription.enabled} onChange={(event) => setDraft({ ...draft, transcription: { ...draft.transcription, enabled: event.target.checked } })} /></label><label>识别语言<select value={draft.transcription.language} onChange={(event) => setDraft({ ...draft, transcription: { ...draft.transcription, language: event.target.value } })}><option value="zh">中文</option><option value="en">English</option><option value="auto">自动识别</option></select></label><div className="model-card"><strong>{draft.transcription.modelName}</strong><span>{modelReady ? "模型已校验" : "模型尚未下载"}</span></div></>;
}

function AiFields({ draft, setDraft, secret, setSecret, configured }: FieldsProps & { secret: string; setSecret(value: string): void; configured: boolean }) {
  return <><h2>Codex 与图片生成</h2><p>Codex 只响应 <code>/codex</code>，图片请求使用独立凭据。</p><label>Codex 模式<select value={draft.codex.mode} onChange={(event) => setDraft({ ...draft, codex: { ...draft.codex, mode: event.target.value as AppConfig["codex"]["mode"] } })}><option value="codex_exec">本地 Codex CLI</option><option value="openai_compatible">OpenAI-compatible API</option></select></label><label>图片 API Key<input type="password" value={secret} placeholder={configured ? "已保存到钥匙串" : "尚未配置"} onChange={(event) => setSecret(event.target.value)} /></label><label>图片模型<input value={draft.image.model} onChange={(event) => setDraft({ ...draft, image: { ...draft.image, model: event.target.value } })} /></label></>;
}

function SecurityFields({ draft, setDraft, choose }: FieldsProps & { choose(): void }) {
  return <><h2>安全与目录</h2><p>未授权目录不能作为 Codex 工作区；可写任务每次都需本机确认。</p><button className="path-picker" onClick={choose}><span>{draft.codex.roots[0]?.path || "选择 Codex 工作目录"}</span><strong>浏览…</strong></button><label>目录权限<select value={draft.codex.roots[0]?.access || "read"} onChange={(event) => setDraft({ ...draft, codex: { ...draft.codex, roots: draft.codex.roots[0] ? [{ ...draft.codex.roots[0], access: event.target.value as "read" | "write" }] : [] } })}><option value="read">只读，自动执行</option><option value="write">可写，每次本机确认</option></select></label><label className="toggle-row"><span><strong>登录时启动</strong><small>使用 macOS 登录项</small></span><input type="checkbox" checked={draft.launchAtLogin} onChange={(event) => setDraft({ ...draft, launchAtLogin: event.target.checked })} /></label></>;
}
