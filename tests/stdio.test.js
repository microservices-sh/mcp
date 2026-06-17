import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { callTool, handleJsonRpcMessage, TOOLS } from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, "../src/index.js");

function parseLine(buffer) {
  const index = buffer.indexOf("\n");
  if (index === -1) return null;
  return {
    line: buffer.slice(0, index),
    rest: buffer.slice(index + 1),
  };
}

async function readMessage(child, state) {
  const existing = parseLine(state.buffer);
  if (existing) {
    state.buffer = existing.rest;
    return JSON.parse(existing.line);
  }

  while (true) {
    const [chunk] = await once(child.stdout, "data");
    state.buffer += chunk.toString("utf8");
    const parsed = parseLine(state.buffer);
    if (parsed) {
      state.buffer = parsed.rest;
      return JSON.parse(parsed.line);
    }
  }
}

async function send(child, state, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return readMessage(child, state);
}

describe("microservices MCP server", () => {
  test("exposes expected MCP tools", async () => {
    const toolNames = TOOLS.map((tool) => tool.name);
    expect(toolNames).toContain("list_templates");
    expect(toolNames).toContain("inspect_module");
    expect(toolNames).toContain("create_preview_plan");
    expect(toolNames).toContain("deploy_preview");
    expect(toolNames).toContain("get_deployment_status");
  });

  test("handles initialize and tool calls through JSON-RPC helpers", async () => {
    const initialized = await handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });

    expect(initialized.result.serverInfo.name).toBe("microservices.sh");
    expect(initialized.result.capabilities.tools).toEqual({});

    const listed = await handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(listed.result.tools.some((tool) => tool.name === "list_modules")).toBe(true);

    const called = await handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_modules", arguments: {} },
    });
    expect(called.result.isError).toBe(false);
    expect(called.result.structuredContent.ok).toBe(true);
    expect(called.result.structuredContent.data.length).toBeGreaterThan(0);
  });

  test("requires explicit confirmation before remote preview deployment", async () => {
    const result = await callTool("deploy_preview", { templateId: "booking-sveltekit" }, { env: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  test("speaks newline-delimited JSON-RPC over stdio", async () => {
    const child = spawn(process.execPath, [BIN], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MICROSERVICES_TELEMETRY: "0" },
    });
    const state = { buffer: "" };

    try {
      const initialized = await send(child, state, {
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {},
      });
      expect(initialized.result.serverInfo.name).toBe("microservices.sh");

      const modules = await send(child, state, {
        jsonrpc: "2.0",
        id: "modules",
        method: "tools/call",
        params: { name: "list_modules", arguments: {} },
      });
      expect(modules.id).toBe("modules");
      expect(modules.result.isError).toBe(false);
      expect(modules.result.structuredContent.data.length).toBeGreaterThan(0);
    } finally {
      child.kill();
    }
  });
});
