// MCP sunucusu Electron'un gömülü Node'u ile (ELECTRON_RUN_AS_NODE) çalışıyor mu?
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electron from "electron";

const dir = mkdtempSync(join(tmpdir(), "ab-"));
const c = new Client({ name: "t", version: "1" });
await c.connect(new StdioClientTransport({
  command: electron, args: [resolve("dist/server.js")],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", AGENT_ID: "claude", DUOREVIEW_DIR: dir },
}));
const r = await c.callTool({ name: "status", arguments: {} });
console.log("OK", r.content[0].text.replace(/\s+/g, " "));
await c.close();
rmSync(dir, { recursive: true, force: true });
