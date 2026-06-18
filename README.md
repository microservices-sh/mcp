# @microservices-sh/mcp

[![npm version](https://img.shields.io/npm/v/%40microservices-sh%2Fmcp.svg)](https://www.npmjs.com/package/@microservices-sh/mcp)
[![Official MCP Registry](https://img.shields.io/badge/MCP%20Registry-sh.microservices%2Fmcp-1f6feb)](https://registry.modelcontextprotocol.io/v0.1/servers?search=sh.microservices/mcp)
[![mcp MCP server](https://glama.ai/mcp/servers/microservices-sh/mcp/badges/score.svg)](https://glama.ai/mcp/servers/microservices-sh/mcp)

MCP server for AI agents that generate, verify, and deploy Cloudflare-native apps from reusable microservices.sh modules.

This package is a standalone stdio MCP server. It vendors a small microservices.sh SDK/module-contract snapshot until the public SDK is split out.

## Why Agents Use It

`@microservices-sh/mcp` gives coding agents a typed planning layer for building production-oriented Cloudflare apps. Agents can discover verified templates and modules, inspect module contracts, compose an app plan, validate configuration, generate project files for review, run readiness checks, and prepare approval-gated preview deployments through the microservices.sh control plane.

It is useful when an agent needs to build apps with common product modules such as auth, booking, customer records, payments, files, and audit logs without inventing each integration from scratch.

## Install

```bash
pnpm add -D @microservices-sh/mcp
```

Or run it directly after publish:

```bash
pnpm dlx @microservices-sh/mcp
```

Or install from Glama:

- [`@microservices-sh/mcp` on Glama](https://glama.ai/mcp/servers/microservices-sh/mcp)

## MCP Client Config

```json
{
  "mcpServers": {
    "microservices": {
      "command": "microservices-mcp",
      "env": {
        "MICROSERVICES_API_URL": "https://api.microservices.sh",
        "MICROSERVICES_API_KEY": "favored-secret-manager-reference"
      }
    }
  }
}
```

For local development inside this repo:

```json
{
  "mcpServers": {
    "microservices-local": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/dist/index.js"]
    }
  }
}
```

Build the local package first:

```bash
pnpm build
```

For agent-oriented one-click install guidance, see [`llms-install.md`](./llms-install.md).

## Tools

Read-only and local planning tools:

- `list_templates`
- `inspect_template`
- `list_modules`
- `inspect_module`
- `list_module_docs`
- `get_module_doc`
- `compose_app`
- `validate_config`
- `generate_project`
- `run_checks`
- `plan_add_module`
- `check_updates`
- `plan_module_upgrade`
- `get_secrets_status`
- `create_preview_plan`

Remote control-plane tools:

- `deploy_preview`
- `get_deployment_status`

`deploy_preview` is mutating and requires `confirm: "preview"`. Run `create_preview_plan` first.

## Environment

| Variable | Purpose |
|----------|---------|
| `MICROSERVICES_API_URL` | Remote control-plane URL. Defaults to `https://api.microservices.sh`. |
| `MICROSERVICES_API_KEY` | Bearer token for remote tools. |
| `MICROSERVICES_TOKEN` | Fallback bearer token. |

Secret values are never returned by the MCP tools.

## Registry Notes

The package is published to npm, listed in the official MCP Registry, and verified by Glama:

- npm: [`@microservices-sh/mcp`](https://www.npmjs.com/package/@microservices-sh/mcp)
- MCP Registry: [`sh.microservices/mcp`](https://registry.modelcontextprotocol.io/v0.1/servers?search=sh.microservices/mcp)
- Glama: [`@microservices-sh/mcp`](https://glama.ai/mcp/servers/microservices-sh/mcp)
- awesome-mcp-servers: [PR #8249](https://github.com/punkpeye/awesome-mcp-servers/pull/8249)
- Remote endpoint: `https://api.microservices.sh/mcp`

The package declares `"mcpName": "sh.microservices/mcp"` in `package.json`. Docker/OCI packaging should wrap this same stdio server rather than forking behavior.
