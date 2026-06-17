import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(join(tmpdir(), "microservices-mcp-smoke-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: options.env ?? process.env,
  });

  if (result.error && typeof result.status !== "number") {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }

  return result;
}

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

try {
  run("pnpm", ["run", "build"], { stdio: "inherit" });
  run("pnpm", ["pack", "--pack-destination", tempRoot], { stdio: "inherit" });

  const tarball = (await readdir(tempRoot)).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) {
    throw new Error(`No tarball produced in ${tempRoot}.`);
  }

  const extractRoot = join(tempRoot, "package-extract");
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  run("tar", ["-xzf", join(tempRoot, tarball), "-C", extractRoot], { stdio: "inherit" });

  const packageDir = join(extractRoot, "package");
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
    throw new Error(`Packed MCP package should not have runtime dependencies:\n${JSON.stringify(manifest, null, 2)}`);
  }

  const entrypoint = join(packageDir, "dist", "index.js");
  if (!existsSync(entrypoint)) {
    throw new Error(`Missing packed MCP entrypoint: ${entrypoint}`);
  }

  const version = run("node", [entrypoint, "--version"]).stdout.trim();
  if (version !== manifest.version) {
    throw new Error(`Packed MCP version mismatch: ${version} !== ${manifest.version}`);
  }

  const child = spawn(process.execPath, [entrypoint], {
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
    if (initialized.result?.serverInfo?.name !== "microservices.sh") {
      throw new Error(`Unexpected initialize response:\n${JSON.stringify(initialized, null, 2)}`);
    }

    const tools = await send(child, state, {
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list",
      params: {},
    });
    if (!tools.result?.tools?.some((tool) => tool.name === "list_modules")) {
      throw new Error(`Packed MCP tools/list missing list_modules:\n${JSON.stringify(tools, null, 2)}`);
    }

    const modules = await send(child, state, {
      jsonrpc: "2.0",
      id: "modules",
      method: "tools/call",
      params: { name: "list_modules", arguments: {} },
    });
    if (modules.result?.isError || !modules.result?.structuredContent?.ok) {
      throw new Error(`Packed MCP list_modules failed:\n${JSON.stringify(modules, null, 2)}`);
    }
  } finally {
    child.kill();
  }

  process.stdout.write("microservices MCP smoke test passed\n");
} catch (error) {
  process.stderr.write(`microservices MCP smoke test failed\nTemp root: ${tempRoot}\n${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
