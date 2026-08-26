import { useState } from "react";
import type { DesktopApi, DesktopSnapshot } from "../lib/desktop-api";
import { Overview } from "./Overview";
import { SettingsPanel } from "./SettingsPanel";

type Section = "overview" | "feishu" | "obsidian" | "transcription" | "ai" | "security" | "diagnostics";

const navigation: Array<{ id: Section; label: string; glyph: string }> = [
  { id: "overview", label: "运行概览", glyph: "◫" },
  { id: "feishu", label: "飞书连接", glyph: "F" },
  { id: "obsidian", label: "Obsidian", glyph: "O" },
  { id: "transcription", label: "语音转写", glyph: "≋" },
  { id: "ai", label: "Codex 与图片", glyph: "C" },
  { id: "security", label: "安全与目录", glyph: "⌂" },
  { id: "diagnostics", label: "诊断与更新", glyph: "◇" }
];

const statusLabel = {
  connected: "运行正常",
  busy: "正在处理",
  error: "需要处理",
  paused: "已暂停",
  "needs-setup": "待配置"
};

interface Props {
  api: DesktopApi;
  snapshot: DesktopSnapshot;
  onChange(snapshot: DesktopSnapshot): void;
}

export function Dashboard({ api, snapshot, onChange }: Props) {
  const [section, setSection] = useState<Section>("overview");
  const [actionBusy, setActionBusy] = useState(false);
  const active = navigation.find((item) => item.id === section) ?? navigation[0];

  async function updateRuntime(action: () => Promise<void>) {
    setActionBusy(true);
    try {
      await action();
      onChange(await api.getSnapshot());
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand sidebar-brand"><span className="brand-mark">FC</span><div><strong>Feishu Codex</strong><small>LOCAL NOTES</small></div></div>
        <nav aria-label="设置区域">
          {navigation.map((item) => (
            <button key={item.id} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>{item.label}
              {item.id === "security" && snapshot.approvals.length > 0 && <span className="nav-count" aria-hidden="true">{snapshot.approvals.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className={`status-dot ${snapshot.status.state}`} /><div><strong>{statusLabel[snapshot.status.state]}</strong><small>{snapshot.status.version}</small></div></div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">FEISHU CODEX</p><h1>{active.label}</h1></div>
          <div className="header-actions">
            <button className="button subtle" disabled={actionBusy} onClick={() => void updateRuntime(() => api.pauseSidecar(snapshot.status.state !== "paused"))}>{snapshot.status.state === "paused" ? "继续接收" : "暂停接收"}</button>
            <button className="button secondary" disabled={actionBusy} onClick={() => void updateRuntime(() => api.restartSidecar())}>重新连接</button>
          </div>
        </header>

        {section === "overview"
          ? <Overview api={api} snapshot={snapshot} onChange={onChange} />
          : <SettingsPanel section={section} api={api} snapshot={snapshot} onChange={onChange} />}
      </main>
    </div>
  );
}
