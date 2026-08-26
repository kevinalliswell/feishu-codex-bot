import { useEffect, useState } from "react";
import type { AppConfig } from "../types";
import type { DesktopApi, DesktopSnapshot, LegacyPreview } from "../lib/desktop-api";

interface Props {
  api: DesktopApi;
  snapshot: DesktopSnapshot;
  onChange(snapshot: DesktopSnapshot): void;
}

const steps = ["欢迎", "飞书", "Obsidian", "语音模型", "AI 与权限", "完成"];

export function Onboarding({ api, snapshot, onChange }: Props) {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<AppConfig>(structuredClone(snapshot.config));
  const [feishuSecret, setFeishuSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [legacy, setLegacy] = useState<LegacyPreview | null>(null);

  useEffect(() => {
    void api.inspectLegacy().then(setLegacy).catch(() => setLegacy(null));
  }, [api]);

  function update(next: AppConfig) {
    setConfig(next);
  }

  async function save(nextStep: number) {
    setBusy(true);
    setMessage("");
    try {
      const saved = await api.saveConfig(config);
      onChange({ ...snapshot, config: saved });
      setStep(nextStep);
    } catch (reason) {
      setMessage(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveFeishu() {
    setBusy(true);
    setMessage("");
    try {
      if (feishuSecret) {
        await api.setSecret("feishuAppSecret", feishuSecret);
        setFeishuSecret("");
      }
      const saved = await api.saveConfig(config);
      await api.testFeishu();
      onChange({
        ...snapshot,
        config: saved,
        secrets: { ...snapshot.secrets, feishuAppSecret: snapshot.secrets.feishuAppSecret || Boolean(feishuSecret) }
      });
      setStep(2);
    } catch (reason) {
      setMessage(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="brand"><span className="brand-mark">FC</span><span>Feishu Codex</span></div>
        <ol className="stepper" aria-label="配置进度">
          {steps.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "done" : ""}><span>{index + 1}</span>{label}</li>)}
        </ol>
      </header>

      <section className="onboarding-card">
        {step === 0 && (
          <div className="welcome-copy">
            <p className="eyebrow">LOCAL-FIRST NOTES</p>
            <h1>把随口一说，变成日后可复盘的笔记</h1>
            <p>飞书负责随手记录，Mac 在本地转写并写进你自己的 Obsidian。语音、密钥和笔记都由你掌控。</p>
            <div className="feature-strip">
              <span>本地 Whisper</span><span>开放 Markdown</span><span>可恢复队列</span>
            </div>
            {legacy?.found && <MigrationCard api={api} legacy={legacy} snapshot={snapshot} onChange={onChange} onImported={(next) => { setConfig(next); setStep(1); }} />}
            {!legacy?.found && <button className="text-button" onClick={async () => { const path = await api.chooseLegacyEnv(); if (path) setLegacy(await api.inspectLegacy(path)); }}>从旧版 .env 导入</button>}
            <button className="button primary large" onClick={() => setStep(1)}>开始配置</button>
          </div>
        )}

        {step === 1 && (
          <div className="form-page">
            <p className="eyebrow">步骤 1 / 5</p>
            <h1>连接飞书</h1>
            <p className="lede">在飞书开放平台创建企业自建应用，启用机器人与消息事件，然后把凭据填在这里。</p>
            <div className="callout">App Secret 只保存到 macOS 钥匙串，不会写入配置文件或日志。</div>
            <label>App ID<input aria-label="App ID" value={config.feishu.appId} placeholder="cli_xxx" onChange={(event) => update({ ...config, feishu: { ...config.feishu, appId: event.target.value } })} /></label>
            <label>App Secret<input aria-label="App Secret" type="password" value={feishuSecret} placeholder={snapshot.secrets.feishuAppSecret ? "已保存在钥匙串" : "输入 App Secret"} onChange={(event) => setFeishuSecret(event.target.value)} /></label>
            <label>允许的飞书会话<input aria-label="允许的飞书会话" value={config.feishu.allowedChatIds.join(", ")} placeholder="oc_xxx，多个用逗号分隔" onChange={(event) => update({ ...config, feishu: { ...config.feishu, allowedChatIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></label>
            <p className="field-help">白名单不能为空时才会接收笔记；建议只填写你和机器人的私聊 chat_id。</p>
            <button className="button primary" disabled={busy || !config.feishu.appId || config.feishu.allowedChatIds.length === 0 || (!feishuSecret && !snapshot.secrets.feishuAppSecret)} onClick={() => void saveFeishu()}>{busy ? "正在测试连接…" : "测试连接并继续"}</button>
          </div>
        )}

        {step === 2 && (
          <div className="form-page">
            <p className="eyebrow">步骤 2 / 5</p><h1>选择你的 Obsidian Vault</h1>
            <p className="lede">只会在你明确选择的 Vault 中创建每日 Markdown。</p>
            <button className="path-picker" onClick={async () => { const path = await api.chooseDirectory(); if (path) update({ ...config, obsidian: { ...config.obsidian, vaultPath: path } }); }}><span>{config.obsidian.vaultPath || "选择 Vault 文件夹"}</span><strong>浏览…</strong></button>
            <label>每日笔记目录<input value={config.obsidian.relativeDir} onChange={(event) => update({ ...config, obsidian: { ...config.obsidian, relativeDir: event.target.value } })} /></label>
            <div className="path-preview">{config.obsidian.vaultPath || "Vault"}/{config.obsidian.relativeDir}/YYYY-MM-DD.md</div>
            <button className="button primary" disabled={busy || !config.obsidian.vaultPath} onClick={() => void save(3)}>保存并继续</button>
          </div>
        )}

        {step === 3 && <ModelStep api={api} ready={snapshot.status.modelReady} onContinue={() => setStep(4)} />}
        {step === 4 && <AiStep api={api} config={config} onConfig={update} onContinue={() => void save(5)} />}
        {step === 5 && <FinishStep api={api} config={config} snapshot={snapshot} onChange={onChange} />}
        {message && <p className="form-error" role="alert">{message}</p>}
      </section>
    </main>
  );
}

function MigrationCard({ api, legacy, snapshot, onChange, onImported }: { api: DesktopApi; legacy: LegacyPreview; snapshot: DesktopSnapshot; onChange(snapshot: DesktopSnapshot): void; onImported(config: AppConfig): void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return <div className="migration-card"><div><strong>发现旧版配置</strong><span>{legacy.appId || "未设置 App ID"} · {legacy.vaultPath || legacy.sourcePath}</span><small>密钥会转入 macOS 钥匙串，旧服务需在新版验证成功后手动停用。</small></div><button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { const config = await api.importLegacy(legacy.sourcePath); onChange({ ...snapshot, config, secrets: { feishuAppSecret: legacy.hasFeishuSecret, assistantApiKey: legacy.hasAssistantApiKey, imageApiKey: legacy.hasImageApiKey } }); onImported(config); setNotice("配置已导入，请逐项验证后再停用旧服务。"); } catch (reason) { setNotice(String(reason)); } finally { setBusy(false); } }}>{busy ? "正在导入…" : "预览并导入"}</button>{notice && <small role="status">{notice}</small>}</div>;
}

function ModelStep({ api, ready, onContinue }: { api: DesktopApi; ready: boolean; onContinue(): void }) {
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(ready);
  const [error, setError] = useState("");
  return <div className="form-page"><p className="eyebrow">步骤 3 / 5</p><h1>准备本地语音模型</h1><p className="lede">约 548MB，只下载一次。下载完成后，口述内容不会发送到云端转写。</p><div className="model-card"><strong>Whisper large-v3-turbo · Q5</strong><span>{done ? "已校验，可以使用" : "中文口述优化 · SHA-256 校验"}</span></div>{!done && <button className="button primary" disabled={downloading} onClick={async () => { setDownloading(true); setError(""); try { await api.downloadModel(); setDone(true); } catch (reason) { setError(String(reason)); } finally { setDownloading(false); } }}>{downloading ? "正在下载并校验…" : "下载模型"}</button>}{done && <button className="button primary" onClick={onContinue}>继续</button>}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}

function AiStep({ api, config, onConfig, onContinue }: { api: DesktopApi; config: AppConfig; onConfig(config: AppConfig): void; onContinue(): void }) {
  const [root, setRoot] = useState(config.codex.roots[0]?.path || "");
  return <div className="form-page"><p className="eyebrow">步骤 4 / 5</p><h1>设置 AI 与本机权限</h1><p className="lede">只读 Codex 可以直接运行；写入任务每次都必须在 Mac 上确认。</p><div className="permission-row"><div><strong>Codex</strong><span>/codex 显式触发</span></div><select aria-label="Codex 权限" value={config.codex.roots[0]?.access || "read"} onChange={(event) => onConfig({ ...config, codex: { ...config.codex, roots: root ? [{ path: root, access: event.target.value as "read" | "write" }] : [] } })}><option value="read">只读</option><option value="write">可写，每次确认</option></select></div><button className="path-picker" onClick={async () => { const path = await api.chooseDirectory(); if (path) { setRoot(path); onConfig({ ...config, codex: { ...config.codex, roots: [{ path, access: config.codex.roots[0]?.access || "read" }] } }); } }}><span>{root || "选择 Codex 工作目录"}</span><strong>浏览…</strong></button><button className="button primary" onClick={onContinue}>保存并继续</button></div>;
}

function FinishStep({ api, config, snapshot, onChange }: { api: DesktopApi; config: AppConfig; snapshot: DesktopSnapshot; onChange(snapshot: DesktopSnapshot): void }) {
  const [busy, setBusy] = useState(false);
  return <div className="form-page finish-page"><div className="success-mark">✓</div><h1>准备就绪</h1><p className="lede">完成后可以在飞书发送 <code>/n 今天的记录</code>，或直接发送语音。</p><button className="button primary large" disabled={busy} onClick={async () => { setBusy(true); const saved = await api.saveConfig({ ...config, onboardingComplete: true }); await api.restartSidecar(); onChange({ ...snapshot, config: saved, status: { ...snapshot.status, state: "connected", sidecarRunning: true } }); }}>{busy ? "正在启动…" : "启动 Feishu Codex"}</button></div>;
}
