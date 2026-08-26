import type { DesktopApi, DesktopSnapshot } from "../lib/desktop-api";

interface Props {
  api: DesktopApi;
  snapshot: DesktopSnapshot;
  onChange(snapshot: DesktopSnapshot): void;
}

function Readiness({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <div className="readiness-item"><span className={ok ? "check ok" : "check"}>{ok ? "✓" : "–"}</span><div><strong>{label}</strong><small>{detail}</small></div></div>;
}

export function Overview({ api, snapshot, onChange }: Props) {
  const { status, config, secrets, approvals } = snapshot;

  async function decide(id: string, approved: boolean) {
    await api.resolveApproval(id, approved);
    onChange({ ...snapshot, approvals: approvals.filter((approval) => approval.id !== id) });
  }

  return (
    <div className="content-stack">
      <section className={`hero-status ${status.state}`}>
        <div><span className={`status-orb ${status.state}`} aria-hidden="true" /><div><p>{status.state === "connected" ? "飞书长连接在线" : "桌面服务状态"}</p><h2>{status.message}</h2></div></div>
        <button className="button light" onClick={() => void api.openTodayNote()} disabled={!status.todayNotePath}>打开今日笔记</button>
      </section>

      <section className="metrics" aria-label="运行指标">
        <article><span>今日目标</span><strong>{config.obsidian.relativeDir}</strong><small>同日内容按时间戳追加</small></article>
        <article><span>待处理队列</span><strong>{status.queueDepth}</strong><small>重启后自动恢复</small></article>
        <article><span>语音模型</span><strong>{status.modelReady ? "已就绪" : "待下载"}</strong><small>{config.transcription.modelName}</small></article>
      </section>

      {approvals.length > 0 && (
        <section className="panel approval-panel">
          <div className="section-heading"><div><p className="eyebrow">LOCAL APPROVAL</p><h2>等待本机确认</h2></div><span className="warning-chip">{approvals.length} 项</span></div>
          {approvals.map((approval) => <article className="approval-card" key={approval.id}><div><strong>{approval.prompt}</strong><small>{approval.requester} · {approval.rootPath}</small></div><div><button className="button subtle" onClick={() => void decide(approval.id, false)}>拒绝</button><button className="button primary" onClick={() => void decide(approval.id, true)}>允许一次</button></div></article>)}
        </section>
      )}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">READINESS</p><h2>功能准备情况</h2></div></div>
        <div className="readiness-grid">
          <Readiness ok={status.feishuConnected} label="飞书连接" detail={config.feishu.appId || "尚未填写 App ID"} />
          <Readiness ok={Boolean(config.obsidian.vaultPath)} label="Obsidian Vault" detail={config.obsidian.vaultPath || "尚未选择目录"} />
          <Readiness ok={status.modelReady} label="本地语音转写" detail={status.modelReady ? "模型校验通过" : "需要下载模型"} />
          <Readiness ok={config.codex.roots.length > 0} label="Codex 目录" detail={config.codex.roots[0]?.path || "未授权任何目录"} />
          <Readiness ok={secrets.imageApiKey} label="图片生成" detail={secrets.imageApiKey ? "API Key 已保存在钥匙串" : "待配置 API Key"} />
          <Readiness ok={config.launchAtLogin} label="登录时启动" detail={config.launchAtLogin ? "已开启" : "已关闭"} />
        </div>
      </section>
    </div>
  );
}
