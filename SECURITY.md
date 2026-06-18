# Security Policy

## Supported Versions

Security updates are provided for the latest published version of `@microservices-sh/mcp`.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately through GitHub Security Advisories for this repository:

https://github.com/microservices-sh/mcp/security/advisories/new

If GitHub advisories are not available to you, open a minimal public issue that asks for a private security contact. Do not include exploit details, secrets, tokens, deployment IDs, or customer data in public issues.

## MCP Safety Model

This MCP server is designed to keep most operations local and inspectable:

- Planning, inspection, validation, project generation, and readiness checks do not write files.
- Secret status tools report configured or missing names only; they do not return secret values.
- Remote preview deployment requires explicit `confirm: "preview"`.
- API keys should be provided through `MICROSERVICES_API_KEY` or `MICROSERVICES_TOKEN`, not pasted into prompts, logs, generated files, or issue comments.

## Disclosure Expectations

When reporting a vulnerability, include:

- Affected version or commit SHA.
- MCP client and transport used.
- Minimal reproduction steps.
- Expected and actual behavior.
- Any relevant logs with secrets redacted.

We will prioritize issues involving secret exposure, unauthorized remote deployment actions, tool schema confusion, command execution, dependency compromise, or registry/package impersonation.
