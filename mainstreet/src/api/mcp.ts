import { Hono } from "hono";
import "../commands/index.ts";
import { getCommand, jsonSchema, listCommands, runCommand } from "../commands/registry.ts";
import { keys } from "../config.ts";
import { safeEqual } from "../util.ts";

// The business as an MCP server: the same commands Atlas uses, for Claude
// Code, Claude Desktop or any MCP client. Streamable HTTP, stateless JSON
// responses. Turn it on with MCP_TOKEN and connect with
//   claude mcp add --transport http mainstreet https://YOUR-SITE/mcp --header "Authorization: Bearer $MCP_TOKEN"

export const mcp = new Hono();

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const INSTRUCTIONS =
  "Mainstreet runs a crew of AI agents that sells ready-made websites to local businesses. Start with get_briefing for an overview. Commands marked as needing confirmation return needsConfirmation first: show the summary to the user and only call again with confirmed: true after they agree.";

async function handle(msg: Rpc): Promise<unknown | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return undefined; // notification
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mainstreet", version: "0.1.0" }, instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: listCommands()
          .filter((d) => !d.clientOnly)
          .map((d) => ({ name: d.name, description: d.description, inputSchema: jsonSchema(d), annotations: { readOnlyHint: d.risk === "read", destructiveHint: d.risk === "confirm", openWorldHint: d.risk !== "read" } })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      if (!getCommand(name)) return fail(-32602, `Unknown tool: ${name}`);
      const r = await runCommand(name, msg.params?.arguments ?? {}, { via: "mcp" });
      return reply({ content: [{ type: "text", text: JSON.stringify(r) }], isError: !r.ok && !r.needsConfirmation });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

mcp.post("/mcp", async (c) => {
  if (!keys.mcp) return c.json({ error: "MCP is off. Set MCP_TOKEN to turn it on." }, 404);
  const auth = c.req.header("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${keys.mcp}`)) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => undefined)) as Rpc | Rpc[] | undefined;
  if (!body) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const out = await handle(body);
  return out ? c.json(out) : c.body(null, 202);
});

mcp.get("/mcp", (c) => c.text("Method Not Allowed", 405));
mcp.delete("/mcp", (c) => c.body(null, 200));
