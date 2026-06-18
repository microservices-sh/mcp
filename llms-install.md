# Installing @microservices-sh/mcp

Use this guide when an MCP client or coding agent needs to install the microservices.sh MCP server.

## Recommended Local Install

Run the published npm package directly:

```json
{
  "mcpServers": {
    "microservices": {
      "command": "npx",
      "args": ["-y", "@microservices-sh/mcp"],
      "env": {
        "MICROSERVICES_API_URL": "https://api.microservices.sh"
      }
    }
  }
}
```

The server starts over stdio. Most tools are read-only planning and inspection tools; mutating preview deployment requires explicit confirmation.

## Optional Remote Tools

Preview-deployment tools use the microservices.sh control plane. To enable authenticated remote operations, add an API key:

```json
{
  "mcpServers": {
    "microservices": {
      "command": "npx",
      "args": ["-y", "@microservices-sh/mcp"],
      "env": {
        "MICROSERVICES_API_URL": "https://api.microservices.sh",
        "MICROSERVICES_API_KEY": "your-api-key"
      }
    }
  }
}
```

Never print or expose the API key in chat transcripts, generated files, logs, or tool responses.

## Smoke Test Prompt

After installation, ask:

```text
List available microservices.sh templates and modules.
```

The server should return template and module options. Good follow-up prompts:

```text
Compose a booking app with auth, customer records, payment, files, and audit logs.
```

```text
Validate the config and create a preview deployment plan. Do not deploy unless I confirm.
```

## Safety Notes

- `deploy_preview` is mutating and requires `confirm: "preview"`.
- Run `create_preview_plan` before `deploy_preview`.
- Secret status tools report configured or missing names only; they do not return secret values.
- Generated project files are returned for review and are not written to disk by the MCP server.
