import { createInterface } from "node:readline";
import {
  checkUpdates,
  composeApp,
  generateProject,
  getModuleDoc,
  getSecretsStatus,
  inspectModule,
  inspectTemplate,
  listModuleDocs,
  listModules,
  listTemplates,
  planAddModule,
  planDeploymentResources,
  planModuleUpgrade,
  runChecks,
  validateConfig,
} from "./sdk/index.js";

const SERVER_NAME = "microservices.sh";
const SERVER_VERSION = "0.1.1";
const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_API_URL = "https://api.microservices.sh";

function text(value) {
  return JSON.stringify(value, null, 2);
}

function sdkFail(code, message, remediation, details = {}) {
  return {
    ok: false,
    requestId: `mcp_${Date.now().toString(36)}`,
    error: {
      code,
      message,
      remediation,
      details,
    },
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`Missing required parameter: ${name}`), {
      code: "INVALID_PARAMS",
      details: { parameter: name },
    });
  }
  return value.trim();
}

function objectParams(params) {
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}

function templateInput(args) {
  return {
    templateId: typeof args.templateId === "string" ? args.templateId : undefined,
    modules: Array.isArray(args.modules) ? args.modules : undefined,
    config: args.config && typeof args.config === "object" && !Array.isArray(args.config) ? args.config : undefined,
  };
}

function apiConfig(env, args = {}) {
  return {
    apiUrl: String(args.apiUrl ?? env.MICROSERVICES_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, ""),
    apiKey: args.apiKey ?? env.MICROSERVICES_API_KEY ?? env.MICROSERVICES_TOKEN ?? null,
  };
}

async function apiRequest(env, args, path, body = null) {
  const config = apiConfig(env, args);
  const headers = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  let response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return sdkFail(
      "REMOTE_API_UNREACHABLE",
      `Could not reach microservices.sh API at ${config.apiUrl}.`,
      "Set MICROSERVICES_API_URL to a running control plane, or use local planning tools first.",
      { apiUrl: config.apiUrl, message: error.message }
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { status: response.status, statusText: response.statusText };
  }

  if (!response.ok) {
    return sdkFail(
      "REMOTE_API_ERROR",
      `microservices.sh API returned HTTP ${response.status}.`,
      "Check API URL, credentials, workspace access, and deployment id.",
      { apiUrl: config.apiUrl, status: response.status, response: payload }
    );
  }

  return {
    ok: true,
    requestId: payload?.requestId ?? `mcp_${Date.now().toString(36)}`,
    data: payload?.data ?? payload,
    warnings: payload?.warnings ?? [],
  };
}

function jsonSchema(properties = {}, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

const TEMPLATE_INPUT_SCHEMA = {
  templateId: {
    type: "string",
    description: "Template id. Defaults to the registry default when omitted.",
  },
  modules: {
    type: "array",
    items: { type: "string" },
    description: "Optional module ids to include.",
  },
  config: {
    type: "object",
    additionalProperties: true,
    description: "Template configuration override.",
  },
};

export const TOOLS = [
  {
    name: "list_templates",
    title: "List Templates",
    description: "List available microservices.sh app templates.",
    inputSchema: jsonSchema(),
  },
  {
    name: "inspect_template",
    title: "Inspect Template",
    description: "Inspect one template contract, modules, defaults, and runtime metadata.",
    inputSchema: jsonSchema(
      {
        templateId: { type: "string", description: "Template id to inspect." },
      },
      ["templateId"]
    ),
  },
  {
    name: "list_modules",
    title: "List Modules",
    description: "List available verified modules.",
    inputSchema: jsonSchema(),
  },
  {
    name: "inspect_module",
    title: "Inspect Module",
    description: "Inspect one module contract, permissions, hooks, events, and resources.",
    inputSchema: jsonSchema(
      {
        moduleId: { type: "string", description: "Module id to inspect." },
      },
      ["moduleId"]
    ),
  },
  {
    name: "list_module_docs",
    title: "List Module Docs",
    description: "List LLM-readable module documentation entries.",
    inputSchema: jsonSchema(),
  },
  {
    name: "get_module_doc",
    title: "Get Module Doc",
    description: "Return an LLM-readable module documentation page.",
    inputSchema: jsonSchema(
      {
        moduleId: { type: "string", description: "Module id to document." },
      },
      ["moduleId"]
    ),
  },
  {
    name: "compose_app",
    title: "Compose App",
    description: "Compose a template and modules into a checked app contract and lockfile plan.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA),
  },
  {
    name: "validate_config",
    title: "Validate Config",
    description: "Validate a template/module config before generation or deployment.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA),
  },
  {
    name: "generate_project",
    title: "Generate Project",
    description: "Generate source files in-memory for inspection. This tool does not write files.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA),
  },
  {
    name: "run_checks",
    title: "Run Checks",
    description: "Run local contract and readiness checks for a template/module composition.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA),
  },
  {
    name: "plan_add_module",
    title: "Plan Add Module",
    description: "Plan an approval-gated module addition without writing files.",
    inputSchema: jsonSchema({
      moduleId: { type: "string", description: "Module id or module@version selector." },
      version: { type: "string", description: "Optional explicit target version." },
      lock: { type: "object", additionalProperties: true, description: "Optional existing microservices.lock.json content." },
    }),
  },
  {
    name: "check_updates",
    title: "Check Updates",
    description: "Check locked modules against the registry snapshot.",
    inputSchema: jsonSchema({
      lock: { type: "object", additionalProperties: true, description: "Optional existing microservices.lock.json content." },
    }),
  },
  {
    name: "plan_module_upgrade",
    title: "Plan Module Upgrade",
    description: "Plan a module version change and report approval gates.",
    inputSchema: jsonSchema({
      moduleId: { type: "string", description: "Module id or module@version selector." },
      version: { type: "string", description: "Optional current version." },
      to: { type: "string", description: "Optional target version." },
      lock: { type: "object", additionalProperties: true, description: "Optional existing microservices.lock.json content." },
    }),
  },
  {
    name: "get_secrets_status",
    title: "Get Secrets Status",
    description: "Report required secret names and configured/missing status without exposing values.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA),
  },
  {
    name: "create_preview_plan",
    title: "Create Preview Plan",
    description: "Create a local preview-readiness plan without mutating remote state.",
    inputSchema: jsonSchema({
      ...TEMPLATE_INPUT_SCHEMA,
      mode: { type: "string", enum: ["embedded", "service"], description: "Deployment topology mode." },
    }),
  },
  {
    name: "deploy_preview",
    title: "Deploy Preview",
    description: "Prepare a remote preview deployment through the microservices.sh control plane. Requires confirm: preview.",
    inputSchema: jsonSchema(
      {
        ...TEMPLATE_INPUT_SCHEMA,
        name: { type: "string", description: "Project or deployment display name." },
        actor: { type: "string", description: "Actor label for audit logs." },
        apiUrl: { type: "string", description: "Optional control-plane URL. Defaults to MICROSERVICES_API_URL or https://api.microservices.sh." },
        apiKey: { type: "string", description: "Optional API key. Prefer MICROSERVICES_API_KEY." },
        confirm: { type: "string", enum: ["preview"], description: "Required confirmation for this mutating tool." },
      },
      ["confirm"]
    ),
  },
  {
    name: "get_deployment_status",
    title: "Get Deployment Status",
    description: "Read a remote deployment status from the microservices.sh control plane.",
    inputSchema: jsonSchema(
      {
        deploymentId: { type: "string", description: "Deployment id." },
        apiUrl: { type: "string", description: "Optional control-plane URL. Defaults to MICROSERVICES_API_URL or https://api.microservices.sh." },
        apiKey: { type: "string", description: "Optional API key. Prefer MICROSERVICES_API_KEY." },
      },
      ["deploymentId"]
    ),
  },
];

const TOOL_HANDLERS = {
  list_templates: () => listTemplates(),
  inspect_template: (args) => inspectTemplate(requiredString(args.templateId, "templateId")),
  list_modules: () => listModules(),
  inspect_module: (args) => inspectModule(requiredString(args.moduleId, "moduleId")),
  list_module_docs: () => listModuleDocs(),
  get_module_doc: (args) => getModuleDoc(requiredString(args.moduleId, "moduleId")),
  compose_app: (args) => composeApp(templateInput(args)),
  validate_config: (args) => validateConfig(templateInput(args)),
  generate_project: (args) => generateProject(templateInput(args)),
  run_checks: (args) => runChecks(templateInput(args)),
  plan_add_module: (args) => planAddModule(args),
  check_updates: (args) => checkUpdates(args),
  plan_module_upgrade: (args) => planModuleUpgrade(args),
  get_secrets_status: (args) => getSecretsStatus(templateInput(args)),
  create_preview_plan: (args) => {
    const input = { ...templateInput(args), mode: args.mode };
    const composition = composeApp(input);
    const checks = runChecks(input);
    const resources = planDeploymentResources(input);
    return {
      ok: true,
      requestId: `mcp_${Date.now().toString(36)}`,
      data: {
        composition: composition.ok ? composition.data : null,
        checks: checks.ok ? checks.data : null,
        resources: resources.ok ? resources.data : null,
        errors: [composition, checks, resources].filter((item) => !item.ok).map((item) => item.error),
        nextSteps: [
          "Review composition, resource plan, and checks.",
          "Run deploy_preview only after approving the preview side effect.",
          "Use confirm: \"preview\" for the deploy_preview tool call.",
        ],
      },
      warnings: [composition, checks, resources].filter((item) => item.ok).flatMap((item) => item.warnings ?? []),
    };
  },
  deploy_preview: async (args, context) => {
    if (args.confirm !== "preview") {
      return sdkFail(
        "CONFIRMATION_REQUIRED",
        "deploy_preview is a mutating tool and requires confirm: \"preview\".",
        "Call create_preview_plan first, review the plan, then call deploy_preview with confirm: \"preview\".",
        { requiredConfirm: "preview" }
      );
    }
    return apiRequest(context.env, args, "/deployments/preview", {
      ...templateInput(args),
      name: typeof args.name === "string" ? args.name : undefined,
      actor: typeof args.actor === "string" ? args.actor : "mcp",
    });
  },
  get_deployment_status: (args, context) =>
    apiRequest(context.env, args, `/deployments/${encodeURIComponent(requiredString(args.deploymentId, "deploymentId"))}`),
};

function toolResult(response) {
  const isError = response?.ok === false;
  return {
    content: [{ type: "text", text: text(response) }],
    structuredContent: response,
    isError,
  };
}

export async function callTool(name, args = {}, context = { env: process.env }) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return toolResult(
      sdkFail(
        "TOOL_NOT_FOUND",
        `Unknown tool: ${name}`,
        "Call tools/list and use one of the returned tool names.",
        { tool: name }
      )
    );
  }

  try {
    const response = await handler(objectParams(args), context);
    return toolResult(response);
  } catch (error) {
    return toolResult(
      sdkFail(
        error.code ?? "TOOL_ERROR",
        error.message ?? `Tool ${name} failed.`,
        "Inspect the tool arguments and retry.",
        error.details ?? {}
      )
    );
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

async function handleRequest(message, context) {
  const id = message.id ?? null;
  const method = message.method;
  const params = objectParams(message.params);

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    });
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = requiredString(params.name, "name");
    const result = await callTool(name, objectParams(params.arguments), context);
    return rpcResult(id, result);
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function handleJsonRpcMessage(message, context = { env: process.env }) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid Request");
  }

  if (!message.id && typeof message.method === "string" && message.method.startsWith("notifications/")) {
    return null;
  }

  try {
    return await handleRequest(message, context);
  } catch (error) {
    return rpcError(
      message.id ?? null,
      error.code === "INVALID_PARAMS" ? -32602 : -32603,
      error.message ?? "Internal error",
      error.details ?? undefined
    );
  }
}

function writeMessage(stdout, message) {
  if (!message) return;
  stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleLine(line, context) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    writeMessage(context.stdout, rpcError(null, -32700, "Parse error", { message: error.message }));
    return;
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const message of messages) {
    const response = await handleJsonRpcMessage(message, context);
    writeMessage(context.stdout, response);
  }
}

export async function startStdioServer({ stdin, stdout, stderr, env }) {
  const context = { stdin, stdout, stderr, env };
  const reader = createInterface({ input: stdin, crlfDelay: Infinity });
  stderr.write(`[microservices-mcp] stdio server started (${SERVER_VERSION})\n`);

  for await (const line of reader) {
    await handleLine(line, context);
  }
}
