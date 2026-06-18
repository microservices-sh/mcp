#!/usr/bin/env node
import { startStdioServer } from "./server.js";

const VERSION = "0.1.2";

function printHelp() {
  process.stdout.write(`microservices-mcp ${VERSION}

Local stdio MCP server for microservices.sh.

Usage:
  microservices-mcp

Environment:
  MICROSERVICES_API_URL   Remote control-plane URL for deploy/status tools
  MICROSERVICES_API_KEY   Bearer token for remote control-plane tools
  MICROSERVICES_TOKEN     Fallback bearer token

The process writes JSON-RPC protocol messages to stdout. Runtime diagnostics go
to stderr so MCP clients can safely parse stdout.
`);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
} else if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(`${VERSION}\n`);
} else {
  startStdioServer({
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  }).catch((error) => {
    process.stderr.write(`[microservices-mcp] fatal: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
