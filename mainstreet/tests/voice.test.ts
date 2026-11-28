import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ms-voice-"));
process.env.QUIET = "1";

const { atlasToolConfigs, ATLAS_PROMPT, ATLAS_FIRST_MESSAGE, ATLAS_DYNAMIC_DEFAULTS } = await import("../src/voice/spec.ts");
const { listCommands } = await import("../src/commands/registry.ts");

type Tool = { tool_config: { type: string; name: string; description: string; parameters?: { properties: Record<string, { dynamic_variable?: string }> }; api_schema?: { url: string; request_body_schema: { properties: Record<string, { dynamic_variable?: string; description?: string }> } } } };

test("client tools: one per command, valid names, browser-only open_screen doesn't block", () => {
  const tools = atlasToolConfigs("client") as Tool[];
  assert.equal(tools.length, listCommands().length);
  for (const t of tools) {
    assert.match(t.tool_config.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(t.tool_config.type, "client");
  }
  assert.ok(tools.some((t) => t.tool_config.name === "open_screen"));
});

test("webhook tools carry the session key and caller id, and confirm tools take a PIN", () => {
  const tools = atlasToolConfigs("webhook", { baseUrl: "https://ms.example.com", secretRef: { secret_id: "sec_1" } }) as Tool[];
  const hook = tools.find((t) => t.tool_config.name === "send_pitch")!;
  assert.equal(hook.tool_config.type, "webhook");
  assert.equal(hook.tool_config.api_schema!.url, "https://ms.example.com/api/voice/tools/send_pitch");
  const props = hook.tool_config.api_schema!.request_body_schema.properties;
  assert.equal(props.session_key.dynamic_variable, "session_key");
  assert.equal(props.caller_id.dynamic_variable, "system__caller_id");
  assert.ok(props.pin.description);
  assert.equal(tools.find((t) => t.tool_config.name === "open_screen")!.tool_config.type, "client");
});

test("every {{variable}} in the prompt has a default", () => {
  const used = new Set([...`${ATLAS_PROMPT} ${ATLAS_FIRST_MESSAGE}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  for (const v of used) assert.ok(v in ATLAS_DYNAMIC_DEFAULTS, `missing default for ${v}`);
});
