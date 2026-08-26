import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Onboarding } from "./components/Onboarding";
import { Dashboard } from "./components/Dashboard";
import { createDesktopApi, type DesktopApi, type DesktopSnapshot } from "./lib/desktop-api";

export function App({ api: suppliedApi }: { api?: DesktopApi }) {
  const api = useMemo(() => suppliedApi ?? createDesktopApi(), [suppliedApi]);
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setSnapshot(await api.getSnapshot());
      setError("");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisteners = [
      listen("runtime-status", () => void refresh()),
      listen("approval-required", () => void refresh()),
      listen<string>("tray-action", async (event) => {
        if (event.payload === "today") await api.openTodayNote();
        if (event.payload === "reconnect") await api.restartSidecar();
        if (event.payload === "pause") {
          const current = await api.getSnapshot();
          await api.pauseSidecar(current.status.state !== "paused");
        }
        await refresh();
      })
    ];
    return () => { for (const unlisten of unlisteners) void unlisten.then((dispose) => dispose()); };
  }, [api]);

  if (error) {
    return (
      <main className="centered-state" role="alert">
        <div className="brand-mark" aria-hidden="true">FC</div>
        <h1>无法打开配置</h1>
        <p>{error}</p>
        <button className="button primary" onClick={() => void refresh()}>重试</button>
      </main>
    );
  }

  if (!snapshot) {
    return <main className="centered-state" aria-busy="true"><span className="spinner" />正在读取本机配置…</main>;
  }

  if (!snapshot.config.onboardingComplete) {
    return <Onboarding api={api} snapshot={snapshot} onChange={setSnapshot} />;
  }

  return <Dashboard api={api} snapshot={snapshot} onChange={setSnapshot} />;
}
