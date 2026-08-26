import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.mjs";
import { startBridge } from "../src/server.mjs";

test("startBridge exposes health state and closes its local server", async () => {
  const states = [];
  const runtime = await startBridge({
    config: loadConfig({
      PORT: "0",
      FEISHU_DELIVERY_MODE: "webhook",
      VOICE_NOTES_ENABLED: "false"
    }),
    onStatus: (state) => states.push(state)
  });

  const response = await fetch(`http://127.0.0.1:${runtime.port}/healthz`);
  const health = await response.json();

  assert.equal(response.status, 200);
  assert.equal(health.ok, true);
  assert.deepEqual(states, ["busy", "connected"]);

  await runtime.close();
  assert.equal(runtime.status(), "stopped");
});
