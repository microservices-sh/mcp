#!/usr/bin/env node

// src/server.js
import { createInterface } from "node:readline";

// src/module-contract/index.js
var CONTRACT_VERSION = "2026-06-13";
var MODULE_SOURCE_REPO = "microservices-sh/microservices-sh";
var MODULE_SOURCE_URL = `https://github.com/${MODULE_SOURCE_REPO}.git`;
var MODULES = Object.freeze([
  {
    id: "auth",
    name: "Auth",
    version: "0.1.0",
    status: "available",
    category: "platform",
    summary: "EdDSA service-token mint/verify, scope checks, and JWKS for auth-gated inter-service communication.",
    requires: [],
    optional: ["audit-log"],
    storage: ["d1"],
    runtime: {
      framework: "hono",
      mount: "/auth",
      bindings: ["DB"]
    },
    eventsEmitted: ["auth.token_minted", "auth.key_rotated"],
    eventsConsumed: [],
    permissions: ["auth.mint", "auth.verify", "auth.admin"],
    rpc: [
      { method: "mintToken", scope: "auth.mint", public: false },
      { method: "verifyToken", scope: "auth.verify", public: false },
      { method: "getJwks", scope: null, public: true }
    ],
    hooks: [
      {
        name: "beforeMintToken",
        timing: "pre",
        purpose: "Clamp or narrow requested scopes and ttl before signing."
      },
      {
        name: "afterTokenMinted",
        timing: "post",
        purpose: "Observe or augment a minted token result."
      }
    ],
    customization: {
      config: ["defaultTtlSeconds", "issuer", "jwksCacheSeconds"],
      hooks: ["beforeMintToken", "afterTokenMinted"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "gateway",
    name: "Gateway",
    version: "0.1.0",
    status: "available",
    category: "platform",
    summary: "Public trust boundary: API-key authentication, rate limiting, scope narrowing, and token exchange via auth.",
    requires: ["auth"],
    optional: ["audit-log"],
    storage: ["d1", "kv"],
    runtime: {
      framework: "hono",
      mount: "/gateway",
      bindings: ["DB", "RATE_LIMIT_KV"]
    },
    eventsEmitted: ["gateway.token_issued", "gateway.access_denied"],
    eventsConsumed: [],
    permissions: ["gateway.admin"],
    rpc: [],
    hooks: [
      {
        name: "beforeIssueToken",
        timing: "pre",
        purpose: "Narrow scopes, attach claims, or reject issuance before minting."
      },
      {
        name: "afterTokenIssued",
        timing: "post",
        purpose: "Observe issued tokens for analytics or audit."
      }
    ],
    customization: {
      config: ["tokenTtlSeconds", "rateLimit", "rateWindowSeconds"],
      hooks: ["beforeIssueToken", "afterTokenIssued"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "customer",
    name: "Customer",
    version: "0.1.0",
    status: "available",
    category: "core",
    summary: "Customer profiles, tags, lifecycle state, consent fields, and customer events.",
    requires: ["auth"],
    optional: ["email", "audit-log"],
    storage: ["d1"],
    runtime: {
      framework: "hono",
      mount: "/customers",
      bindings: ["DB"]
    },
    eventsEmitted: ["customer.created", "customer.updated"],
    eventsConsumed: [],
    permissions: ["customer.read", "customer.write", "customer.admin"],
    rpc: [
      { method: "getCustomer", scope: "customer.read", public: false },
      { method: "listCustomers", scope: "customer.read", public: false },
      { method: "upsertCustomer", scope: "customer.write", public: false }
    ],
    hooks: [
      {
        name: "beforeCustomerCreate",
        timing: "pre",
        purpose: "Normalize incoming customer data and enforce business-specific required fields."
      },
      {
        name: "afterCustomerUpdated",
        timing: "post",
        purpose: "Sync customer changes to external CRMs or notification flows."
      }
    ],
    customization: {
      config: ["profileFields", "tags", "segments", "consentFields"],
      hooks: ["beforeCustomerCreate", "afterCustomerUpdated"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "booking",
    name: "Booking",
    version: "0.1.0",
    status: "available",
    category: "vertical",
    summary: "Service booking, availability, cancellation windows, confirmation, and booking events.",
    requires: ["auth", "customer"],
    optional: ["payment", "email", "staff", "audit-log"],
    storage: ["d1", "kv"],
    runtime: {
      framework: "hono",
      mount: "/bookings",
      bindings: ["DB", "CACHE_KV", "NOTIFICATIONS"]
    },
    eventsEmitted: ["booking.created", "booking.confirmed", "booking.cancelled"],
    eventsConsumed: ["customer.created", "payment.succeeded"],
    permissions: ["booking.read", "booking.write", "booking.admin"],
    rpc: [
      { method: "listBookings", scope: "booking.read", public: false },
      { method: "getBooking", scope: "booking.read", public: false },
      { method: "getAvailability", scope: "booking.read", public: false }
    ],
    hooks: [
      {
        name: "beforeBookingCreate",
        timing: "pre",
        purpose: "Validate booking rules before a booking record is created."
      },
      {
        name: "calculateAvailability",
        timing: "compute",
        purpose: "Replace or adjust generated availability slots with business-specific rules."
      },
      {
        name: "afterBookingConfirmed",
        timing: "post",
        purpose: "Run post-confirmation workflows such as reminders or payment capture."
      }
    ],
    customization: {
      config: [
        "serviceTypes",
        "slotIntervalMinutes",
        "defaultDurationMinutes",
        "leadTimeMinutes",
        "cancellationWindowHours",
        "allowWaitlist"
      ],
      hooks: ["beforeBookingCreate", "calculateAvailability", "afterBookingConfirmed"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "audit-log",
    name: "Audit Log",
    version: "0.1.0",
    status: "available",
    category: "sink",
    summary: "Append-only audit trail. Pure event sink: records domain events from a signed queue or direct calls.",
    requires: [],
    optional: [],
    storage: ["d1"],
    runtime: {
      framework: "hono",
      mount: "/audit",
      bindings: ["DB"]
    },
    eventsEmitted: ["audit.recorded", "audit.exported"],
    eventsConsumed: [],
    permissions: ["audit.read", "audit.export", "audit.admin"],
    rpc: [],
    hooks: [
      {
        name: "redactAuditPayload",
        timing: "pre",
        purpose: "Redact or drop sensitive fields before an audit record is persisted."
      },
      {
        name: "beforeAuditExport",
        timing: "pre",
        purpose: "Filter or guard an audit export request."
      }
    ],
    customization: {
      config: ["requireSignedEnvelope", "defaultListLimit"],
      hooks: ["redactAuditPayload", "beforeAuditExport"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "payment",
    name: "Payment",
    version: "0.1.0",
    status: "available",
    category: "provider",
    summary: "Stripe-backed payment provider: create payment intents, record payments, and verify signed Stripe webhooks. Emits payment lifecycle events.",
    requires: ["auth", "customer"],
    optional: ["audit-log"],
    storage: ["d1"],
    runtime: {
      framework: "hono",
      mount: "/payments",
      bindings: ["DB"]
    },
    secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    eventsEmitted: ["payment.checkout_created", "payment.succeeded", "payment.refunded", "payment.failed"],
    eventsConsumed: [],
    permissions: ["payment.read", "payment.write", "payment.admin"],
    rpc: [
      { method: "createPaymentIntent", scope: "payment.write", public: false }
    ],
    hooks: [
      {
        name: "beforeCreatePaymentIntent",
        timing: "pre",
        purpose: "Adjust or validate intent input before the gateway call."
      },
      {
        name: "afterPaymentSucceeded",
        timing: "post",
        purpose: "Run side-effects after a payment is marked succeeded."
      }
    ],
    customization: {
      config: ["defaultCurrency", "requireWebhookSecret", "defaultListLimit"],
      hooks: ["beforeCreatePaymentIntent", "afterPaymentSucceeded"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "idempotency",
    name: "Idempotency",
    version: "0.1.0",
    status: "available",
    category: "core",
    summary: "Scoped idempotency records for safe retry, replay, and duplicate side-effect prevention.",
    requires: [],
    optional: ["audit-log", "jobs-workflows"],
    storage: ["d1"],
    runtime: {
      framework: "hono",
      mount: "/idempotency",
      bindings: ["DB"]
    },
    eventsEmitted: [
      "idempotency.claimed",
      "idempotency.replayed",
      "idempotency.completed",
      "idempotency.failed",
      "idempotency.expired_pruned"
    ],
    eventsConsumed: [],
    permissions: ["idempotency.claim", "idempotency.read", "idempotency.admin"],
    rpc: [
      { method: "claimIdempotency", scope: "idempotency.claim", public: false },
      { method: "getIdempotencyRecord", scope: "idempotency.read", public: false }
    ],
    hooks: [
      {
        name: "beforeIdempotencyClaim",
        timing: "pre",
        purpose: "Validate, enrich, or reject a claim before it is persisted or replayed."
      },
      {
        name: "afterIdempotencyComplete",
        timing: "post",
        purpose: "Observe a completed idempotency record for audit or activity feeds."
      },
      {
        name: "onIdempotencyReplay",
        timing: "post",
        purpose: "Observe terminal record replay without creating a duplicate side effect."
      }
    ],
    customization: {
      config: ["defaultTtlMs", "defaultLockTtlMs", "maxTtlMs"],
      hooks: ["beforeIdempotencyClaim", "afterIdempotencyComplete", "afterIdempotencyFail", "onIdempotencyReplay"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: false, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  },
  {
    id: "webhook-delivery",
    name: "Webhook Delivery",
    version: "0.1.0",
    status: "available",
    category: "sink",
    summary: "Outbound mirror of the event bus: registers external endpoints (per-endpoint signing secret), delivers HMAC-signed domain events, and logs delivery attempts.",
    requires: [],
    optional: ["audit-log"],
    storage: ["d1"],
    runtime: {
      framework: "hono",
      mount: "/webhooks",
      bindings: ["DB"]
    },
    // External outbound HTTP side-effects make this approval-gated despite being
    // a sink (audit-log, also a sink, stays medium — it never leaves the account).
    approvalRisk: "high",
    secrets: [],
    eventsEmitted: ["webhook.delivered", "webhook.failed"],
    eventsConsumed: [],
    permissions: ["webhook.read", "webhook.write", "webhook.admin"],
    rpc: [],
    hooks: [
      {
        name: "beforeWebhookDeliver",
        timing: "pre",
        purpose: "Adjust or drop an outbound event before delivery."
      },
      {
        name: "afterWebhookDelivered",
        timing: "post",
        purpose: "Observe a delivery attempt result."
      }
    ],
    customization: {
      config: ["defaultListLimit", "maxRetries"],
      hooks: ["beforeWebhookDeliver", "afterWebhookDelivered"],
      forkable: true
    },
    quality: {
      tests: { unit: true, integration: true, fixtures: true },
      agentDocs: true,
      migrations: true,
      upgradeNotes: true
    }
  }
]);
var TEMPLATES = Object.freeze([
  {
    id: "booking-business",
    name: "Booking Business",
    version: "0.1.0",
    status: "available",
    summary: "A bookable service business foundation for studios, clinics, consultants, and local operators.",
    targetCustomer: "AI-heavy agencies, consultants, and technical founders building custom booking systems.",
    defaultModules: ["gateway", "auth", "customer", "booking"],
    optionalModules: ["email", "payment", "admin", "audit-log", "idempotency", "webhook-delivery"],
    targetRuntime: {
      language: "typescript",
      framework: "hono",
      platform: "cloudflare-workers",
      storage: ["d1", "kv"]
    },
    defaultConfig: {
      appName: "Booking Business",
      appSlug: "booking-business",
      timezone: "UTC",
      currency: "USD",
      auth: {
        defaultRole: "member",
        sessionTtlSeconds: 604800
      },
      customer: {
        profileFields: ["name", "email", "phone", "notes"],
        consentFields: ["emailMarketingConsent"]
      },
      booking: {
        serviceTypes: ["consultation", "standard-service"],
        slotIntervalMinutes: 30,
        defaultDurationMinutes: 60,
        leadTimeMinutes: 120,
        cancellationWindowHours: 24,
        maxFutureDays: 90,
        allowWaitlist: false
      }
    },
    successCriteria: [
      "Generated Hono Worker can run locally with Wrangler.",
      "Generated schema includes account, customer, booking, event, and audit tables.",
      "Hooks are explicit files an agent can customize without changing module internals.",
      "Module lock records exact module versions used for upgrade comparison."
    ]
  }
]);
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
function createContractError(code, message, remediation, details = {}) {
  const error = new Error(message);
  error.name = "MicroservicesContractError";
  error.code = code;
  error.remediation = remediation;
  error.details = details;
  return error;
}
function moduleSummary(module) {
  return {
    id: module.id,
    name: module.name,
    version: module.version,
    status: module.status,
    category: module.category,
    summary: module.summary,
    requires: clone(module.requires),
    mount: module.runtime.mount
  };
}
function templateSummary(template) {
  return {
    id: template.id,
    name: template.name,
    version: template.version,
    status: template.status,
    summary: template.summary,
    defaultModules: clone(template.defaultModules),
    optionalModules: clone(template.optionalModules)
  };
}
function findById(items, id, kind) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw createContractError(
      `${kind.toUpperCase()}_NOT_FOUND`,
      `Unknown ${kind}: ${id}`,
      `Run "${kind}s list --json" and select one of the returned ids.`,
      { id }
    );
  }
  return item;
}
function parseModuleRef(value, explicitVersion = null) {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  const at = raw.lastIndexOf("@");
  const inline = at > 0 ? {
    id: raw.slice(0, at),
    version: raw.slice(at + 1) || null
  } : {
    id: raw,
    version: null
  };
  const version = explicitVersion ? String(explicitVersion).trim() : inline.version;
  if (inline.version && explicitVersion && inline.version !== String(explicitVersion).trim()) {
    throw createContractError(
      "MODULE_VERSION_CONFLICT",
      `Conflicting versions requested for module ${inline.id}.`,
      "Use either module@version or --version/--to, not both with different versions.",
      { moduleId: inline.id, inlineVersion: inline.version, explicitVersion: String(explicitVersion).trim() }
    );
  }
  return {
    id: inline.id,
    version,
    raw
  };
}
function availableModuleVersions(id) {
  const versions = MODULES.filter((candidate) => candidate.id === id).map((module) => module.version);
  if (!versions.length) {
    throw createContractError(
      "MODULE_NOT_FOUND",
      `Unknown module: ${id}`,
      'Run "modules list --json" and select one of the returned ids.',
      { id }
    );
  }
  return unique(versions);
}
function findModuleByRef(ref, explicitVersion = null) {
  const selector = parseModuleRef(ref, explicitVersion);
  const candidates = MODULES.filter((candidate) => candidate.id === selector.id);
  if (!candidates.length) {
    throw createContractError(
      "MODULE_NOT_FOUND",
      `Unknown module: ${selector.id}`,
      'Run "modules list --json" and select one of the returned ids.',
      { id: selector.id }
    );
  }
  const module = selector.version ? candidates.find((candidate) => candidate.version === selector.version) : candidates[candidates.length - 1];
  if (!module) {
    throw createContractError(
      "MODULE_VERSION_NOT_FOUND",
      `Module ${selector.id}@${selector.version} is not available in this registry snapshot.`,
      "Select one of the available versions or omit the version to use the current registry version.",
      {
        id: selector.id,
        moduleId: selector.id,
        requestedVersion: selector.version,
        availableVersions: candidates.map((candidate) => candidate.version)
      }
    );
  }
  return module;
}
function moduleRefString(module) {
  return `${module.id}@${module.version}`;
}
function moduleReleaseTag(id, version) {
  return `modules/${id}/v${version}`;
}
function moduleSourceRef(input, version = null) {
  const module = typeof input === "string" ? { id: input, version } : input;
  return {
    type: "git",
    repo: MODULE_SOURCE_REPO,
    url: MODULE_SOURCE_URL,
    tag: moduleReleaseTag(module.id, module.version),
    ref: `refs/tags/${moduleReleaseTag(module.id, module.version)}`,
    path: `modules/${module.id}`
  };
}
function resolveModuleRefs(moduleRefs) {
  const explicitVersions = /* @__PURE__ */ new Map();
  for (const value of moduleRefs) {
    const ref = parseModuleRef(value);
    if (!ref.id || !ref.version) continue;
    const existing = explicitVersions.get(ref.id);
    if (existing && existing !== ref.version) {
      throw createContractError(
        "MODULE_VERSION_CONFLICT",
        `Conflicting versions requested for module ${ref.id}.`,
        "Request a single version for each module.",
        { moduleId: ref.id, requestedVersions: [existing, ref.version] }
      );
    }
    explicitVersions.set(ref.id, ref.version);
  }
  const visited = /* @__PURE__ */ new Set();
  const ordered = [];
  function visit(value) {
    const ref = parseModuleRef(value);
    const version = explicitVersions.get(ref.id) ?? ref.version;
    const module = findModuleByRef(ref.id, version);
    if (visited.has(module.id)) return;
    visited.add(module.id);
    for (const requiredId of module.requires) {
      visit(requiredId);
    }
    ordered.push(module);
  }
  for (const moduleRef of moduleRefs) {
    visit(moduleRef);
  }
  return ordered;
}
function mergeConfig(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return clone(base);
  }
  const output = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      output[key] = mergeConfig(output[key], value);
    } else {
      output[key] = clone(value);
    }
  }
  return output;
}
function listModules() {
  return MODULES.map((module) => ({
    ...moduleSummary(module),
    latestVersion: module.version,
    availableVersions: availableModuleVersions(module.id),
    sourceRef: moduleSourceRef(module)
  }));
}
function inspectModule(id) {
  return clone(findModuleByRef(id));
}
function listTemplates() {
  return TEMPLATES.map(templateSummary);
}
function inspectTemplate(id) {
  return clone(findById(TEMPLATES, id, "template"));
}
function createModuleLock(modules, template = null) {
  return {
    schemaVersion: CONTRACT_VERSION,
    generatedAt: "deterministic-local-preview",
    registry: {
      id: "microservices.sh",
      contractVersion: CONTRACT_VERSION
    },
    generator: {
      package: "create-microservices-app",
      version: "0.0.0"
    },
    template: template ? {
      id: template.id,
      version: template.version,
      source: `registry:${template.id}@${template.version}`,
      checksum: `sha256:preview-${template.id}-${template.version}`
    } : null,
    // App-level deploy topology (plans/24). Default is embedded; service mode is
    // opt-in and recorded per-module below.
    deploy: { mode: "embedded" },
    modules: modules.map((module) => ({
      id: module.id,
      version: module.version,
      source: `registry:${module.id}@${module.version}`,
      sourceRef: moduleSourceRef(module),
      checksum: `sha256:preview-${module.id}-${module.version}`,
      customizationMode: "config-hooks",
      // Per-module topology. In service mode this also carries worker + d1 names.
      mode: "embedded",
      contract: {
        mount: module.runtime.mount,
        bindings: clone(module.runtime.bindings),
        resources: module.storage.map((item) => item.toUpperCase()),
        permissions: clone(module.permissions),
        rpc: clone(module.rpc ?? []),
        hooks: module.hooks.map((hook) => hook.name),
        events: unique([...module.eventsEmitted, ...module.eventsConsumed]),
        requires: clone(module.requires),
        secrets: clone(module.secrets ?? [])
      }
    })),
    customizations: {
      config: true,
      hooks: modules.flatMap((module) => module.customization?.hooks ?? []),
      overlays: [],
      forks: []
    }
  };
}
function composeApp(input = {}) {
  const options = typeof input === "string" ? { templateId: input } : input;
  const templateId = options.templateId ?? options.template ?? "booking-business";
  const template = inspectTemplate(templateId);
  const requestedModules = unique([
    ...template.defaultModules,
    ...options.modules ?? []
  ]);
  const modules = resolveModuleRefs(requestedModules).map(clone);
  const resolvedModuleIds = modules.map((module) => module.id);
  const config = mergeConfig(template.defaultConfig, options.config);
  return {
    schemaVersion: CONTRACT_VERSION,
    compositionId: `cmp_${template.id}_${modules.map(moduleRefString).join("_")}`,
    template: templateSummary(template),
    config,
    modules,
    routes: modules.map((module) => ({
      module: module.id,
      mount: module.runtime.mount,
      framework: module.runtime.framework
    })),
    bindings: unique(modules.flatMap((module) => module.runtime.bindings)),
    storage: unique(modules.flatMap((module) => module.storage)),
    permissions: unique(modules.flatMap((module) => module.permissions)),
    events: {
      emitted: unique(modules.flatMap((module) => module.eventsEmitted)),
      consumed: unique(modules.flatMap((module) => module.eventsConsumed))
    },
    hooks: modules.flatMap(
      (module) => module.hooks.map((hook) => ({
        module: module.id,
        ...hook
      }))
    ),
    checks: [
      "module-contract",
      "dependency-resolution",
      "worker-bindings",
      "schema-presence",
      "hook-surface",
      "audit-events"
    ],
    upgradePolicy: {
      mode: "contract-lock",
      lockfile: "microservices.lock.json",
      compatibleCustomization: ["config", "hooks"],
      manualCustomization: ["fork", "export"]
    },
    lock: createModuleLock(modules, template)
  };
}

// src/sdk/index.js
function requestId() {
  return `local_${Date.now().toString(36)}`;
}
function ok(data, warnings = []) {
  return {
    ok: true,
    requestId: requestId(),
    data,
    warnings
  };
}
function fail(error) {
  return {
    ok: false,
    requestId: requestId(),
    error: {
      code: error.code ?? "UNKNOWN_ERROR",
      message: error.message,
      remediation: error.remediation ?? "Inspect the command input and retry.",
      details: error.details ?? {}
    }
  };
}
function capture(fn) {
  try {
    return ok(fn());
  } catch (error) {
    return fail(error);
  }
}
function slugify(value) {
  return String(value ?? "microservices-app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "microservices-app";
}
function json(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
var PLANNED_MODULE_DOCS = Object.freeze([
  {
    id: "email",
    name: "Email",
    version: "0.1.0",
    status: "planned",
    class: "provider-capable core",
    mount: "/emails",
    summary: "Transactional email templates, provider adapters, delivery jobs, and delivery events.",
    requires: [],
    permissions: ["email.read", "email.write", "email.admin"],
    approvalRisk: "high",
    secrets: ["EMAIL_PROVIDER_API_KEY"],
    resources: ["Queue for delivery jobs", "outbound fetch to provider API"],
    hooks: ["renderEmailTemplate", "beforeEmailSend", "afterEmailDelivered"],
    events: ["email.queued", "email.sent", "email.failed"],
    statusNote: "Planned provider-capable module. Start with test mode and approval-gated sends."
  }
]);
function docPathFor(moduleId) {
  return `docs/modules/${moduleId}.md`;
}
function availableModuleDocs() {
  return listModules().map((summary) => {
    const module = inspectModule(summary.id);
    return {
      id: module.id,
      name: module.name,
      version: module.version,
      status: module.status,
      class: module.category,
      mount: module.runtime.mount,
      docPath: docPathFor(module.id),
      summary: module.summary,
      requires: module.requires,
      permissions: module.permissions,
      rpc: module.rpc ?? [],
      approvalRisk: module.approvalRisk ?? (module.category === "platform" || module.category === "provider" ? "high" : "medium"),
      secrets: module.secrets ?? (module.id === "auth" ? ["AUTH_SIGNING_KEY"] : []),
      resources: module.storage.map((item) => item.toUpperCase()),
      hooks: module.hooks.map((hook) => hook.name),
      events: [...module.eventsEmitted, ...module.eventsConsumed],
      sourceRef: moduleSourceRef(module),
      statusNote: "Available in the generated MVP app."
    };
  });
}
function moduleCatalog() {
  const modules = [...availableModuleDocs(), ...PLANNED_MODULE_DOCS].map((module) => ({
    id: module.id,
    name: module.name,
    version: module.version,
    status: module.status,
    class: module.class,
    mount: module.mount,
    docPath: module.docPath ?? docPathFor(module.id),
    summary: module.summary,
    requires: module.requires,
    permissions: module.permissions,
    rpc: module.rpc ?? [],
    approvalRisk: module.approvalRisk,
    secrets: module.secrets,
    resources: module.resources,
    hooks: module.hooks,
    events: module.events,
    sourceRef: module.sourceRef ?? moduleSourceRef(module.id, module.version)
  }));
  return {
    schemaVersion: "2026-06-13",
    description: "Compact LLM-readable catalog for generated microservices.sh projects. Read the referenced Markdown docs before modifying modules.",
    agentGuidance: {
      preferDocsBeforeCodeChanges: true,
      neverExposeSecretValues: true,
      defaultCustomizationOrder: ["config", "hooks", "overlays", "fork"],
      approvalGatedCategories: ["auth", "payment", "email", "pii", "webhook", "migration", "production_deploy", "delete"],
      sourceOwnershipDefault: "user-owned repository with branch/PR or patch workflow"
    },
    modules
  };
}
function uniqueValues(values) {
  return [...new Set(values)];
}
function parseModuleSelector(value, explicitVersion = null) {
  try {
    return parseModuleRef(String(value ?? ""), explicitVersion);
  } catch (error) {
    error.remediation ??= "Use module@version or pass a matching --version/--to value.";
    throw error;
  }
}
function catalogVersions(moduleId) {
  return uniqueValues(moduleCatalog().modules.filter((candidate) => candidate.id === moduleId).map((module) => module.version));
}
function findCatalogModule(moduleId, explicitVersion = null) {
  const selector = parseModuleSelector(moduleId, explicitVersion);
  const candidates = moduleCatalog().modules.filter((candidate) => candidate.id === selector.id);
  if (!candidates.length) {
    const error = new Error(`Unknown module: ${selector.id}`);
    error.code = "MODULE_NOT_FOUND";
    error.remediation = "Run modules list --json and select a returned module id.";
    error.details = { moduleId: selector.id };
    throw error;
  }
  const module = selector.version ? candidates.find((candidate) => candidate.version === selector.version) : candidates[0];
  if (!module) {
    const error = new Error(`Module ${selector.id}@${selector.version} is not available in this registry snapshot.`);
    error.code = "MODULE_VERSION_NOT_FOUND";
    error.remediation = "Select one of the available versions or omit the version to use the current registry version.";
    error.details = {
      moduleId: selector.id,
      requestedVersion: selector.version,
      availableVersions: candidates.map((candidate) => candidate.version)
    };
    throw error;
  }
  return module;
}
function moduleRequest(options, versionKeys = ["version"]) {
  const moduleId = options.moduleId ?? options.id;
  const explicitVersion = versionKeys.map((key) => options[key]).find((value) => typeof value === "string" && value.trim());
  return parseModuleSelector(moduleId, explicitVersion ?? null);
}
function parseSemver(value) {
  const match = String(value ?? "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map((part) => Number(part)) : null;
}
function compareVersions(a, b) {
  if (a === b) return 0;
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left && right) {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
  }
  return String(a) < String(b) ? -1 : 1;
}
function versionDirection(currentVersion, targetVersion) {
  const comparison = compareVersions(currentVersion, targetVersion);
  if (comparison < 0) return "upgrade";
  if (comparison > 0) return "downgrade";
  return "none";
}
function moduleDocMarkdown(module) {
  return `# ${module.name}

Status: ${module.status}
Module ID: \`${module.id}\`
Mount: \`${module.mount}\`

## Summary
${module.summary}

## Dependencies
${module.requires.length ? module.requires.map((item) => `- ${item}`).join("\n") : "- none"}

## Permissions
${module.permissions.map((item) => `- ${item}`).join("\n")}

## Secrets
${module.secrets.length ? module.secrets.map((item) => `- ${item}`).join("\n") : "- none"}

Agents may inspect secret names and configured/missing status. They must not request or print secret values.

## Resources
${module.resources.length ? module.resources.map((item) => `- ${item}`).join("\n") : "- none"}

## Hooks
${module.hooks.length ? module.hooks.map((item) => `- ${item}`).join("\n") : "- none"}

## Events
${module.events.length ? module.events.map((item) => `- ${item}`).join("\n") : "- none"}

## Approval Gate
Risk: ${module.approvalRisk}

Adding or changing auth, payment, email, webhook, migration, PII, or production deploy behavior requires explicit approval.

## Update Notes
Config and hook changes are expected to stay upgradeable. Overlays and forks require manual or agent-assisted merge review.
`;
}
function buildLlmGuide(composition) {
  return `# ${composition.config.appName ?? composition.template.name} Agent Guide

This project was generated by microservices.sh.

## First Commands
\`\`\`bash
pnpm install
pnpm microservices modules list --json
pnpm microservices docs booking
pnpm microservices upgrade booking --plan --json
pnpm microservices check --json
pnpm dev
\`\`\`

## Agent Rules
1. Read \`microservices.lock.json\` before changing modules.
2. Read \`docs/modules/catalog.json\` and the relevant module docs before edits.
3. Prefer config and hooks before editing module internals.
4. Never ask the user to paste secret values into chat.
5. Treat payment, email, auth, PII, webhooks, migrations, and production deploys as approval-gated.
6. Run \`pnpm microservices check --json\` before preview or production deployment.
7. Run \`pnpm microservices upgrade <module-id> --plan --json\` before changing locked module versions.

## Current Modules
${composition.modules.map((module) => `- ${module.id}@${module.version} at ${module.runtime.mount}`).join("\n")}
`;
}
function buildMicroservicesConfig(composition) {
  return json({
    schemaVersion: "2026-06-13",
    template: composition.template.id,
    runtime: {
      framework: "hono",
      platform: "cloudflare-workers"
    },
    moduleDocs: "docs/modules/catalog.json",
    lockfile: "microservices.lock.json",
    managedCloudflare: {
      dispatchNamespace: "microservices-sh",
      previewDeploy: "approval-gated"
    }
  });
}
function buildPackageJson(composition) {
  const appSlug = slugify(composition.config.appSlug ?? composition.config.appName);
  return json({
    name: appSlug,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "wrangler dev",
      deploy: "wrangler deploy",
      "db:init": "wrangler d1 execute microservices_generated --local --file=./schema.sql",
      microservices: "node scripts/microservices.js",
      ms: "node scripts/microservices.js",
      check: "node scripts/microservices.js check && tsc --noEmit",
      typecheck: "tsc --noEmit"
    },
    dependencies: {
      hono: "^4.6.14"
    },
    devDependencies: {
      "@cloudflare/workers-types": "^4.20241218.0",
      typescript: "^5.9.3",
      wrangler: "^3.95.0"
    }
  });
}
function buildWranglerJson(composition) {
  const appSlug = slugify(composition.config.appSlug ?? composition.config.appName);
  return json({
    $schema: "node_modules/wrangler/config-schema.json",
    name: appSlug,
    main: "src/index.ts",
    compatibility_date: "2026-06-01",
    compatibility_flags: ["nodejs_compat"],
    observability: { enabled: true },
    d1_databases: [
      {
        binding: "DB",
        database_name: "microservices_generated",
        database_id: "REPLACE_WITH_D1_ID"
      }
    ],
    kv_namespaces: [
      {
        binding: "CACHE_KV",
        id: "REPLACE_WITH_KV_ID"
      },
      {
        binding: "RATE_LIMIT_KV",
        id: "REPLACE_WITH_RATE_LIMIT_KV_ID"
      }
    ],
    // Event bus (plans/24 layer 3): this Worker is both producer and consumer of
    // the domain-event queue. The consumer routes events to the audit sink.
    queues: {
      producers: [{ binding: "EVENTS", queue: `${appSlug}-events` }],
      consumers: [{ queue: `${appSlug}-events`, max_batch_size: 10, max_batch_timeout: 5 }]
    }
  });
}
function buildSchemaSql() {
  return `-- Auth owns signing keys for inter-service tokens (EdDSA). The private key is
-- stored here for local/preview; production must wrap it with a secret/KMS binding.
CREATE TABLE IF NOT EXISTS signing_keys (
  kid TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL,
  public_jwk TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  workspace TEXT NOT NULL,
  project TEXT NOT NULL,
  subject TEXT NOT NULL,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  actor_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signing_keys_status ON signing_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(hash);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_starts_at ON bookings(starts_at);
CREATE INDEX IF NOT EXISTS idx_domain_events_name ON domain_events(event_name);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
`;
}
function buildTsConfig() {
  return json({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      lib: ["ES2022"],
      types: ["@cloudflare/workers-types"],
      strict: true,
      skipLibCheck: true,
      noEmit: true
    },
    include: ["src/**/*.ts"]
  });
}
function buildEnvTs() {
  return `export interface Env {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  NOTIFICATIONS?: Queue;
  // Event bus producer binding (plans/24 layer 3). Optional: when unset, domain
  // events are still written to D1 and the queue publish is skipped.
  EVENTS?: Queue;
  // HMAC secret used to sign queue event envelopes. Set as a Wrangler secret.
  EVENT_BUS_SECRET?: string;
}
`;
}
function buildAuditTs() {
  return `import type { Env } from "./env";

export interface AuditPayload {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
}

export async function writeAudit(env: Env, eventName: string, input: AuditPayload = {}) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO audit_events (id, event_name, actor_id, entity_type, entity_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      eventName,
      input.actorId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      JSON.stringify(input.payload ?? {}),
      now
    )
    .run();

  return { id, eventName, createdAt: now };
}

export async function emitDomainEvent(
  env: Env,
  eventName: string,
  entityType: string,
  entityId: string,
  payload: unknown = {}
) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO domain_events (id, event_name, entity_type, entity_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, eventName, entityType, entityId, JSON.stringify(payload), now)
    .run();

  return { id, eventName, createdAt: now };
}
`;
}
function buildEventsTs() {
  return `import type { Env } from "./env";
import { writeAudit } from "./audit";

export interface EventEnvelope {
  eventName: string;
  entityType: string;
  entityId: string;
  source: string;
  actorId?: string | null;
  payload: Record<string, unknown>;
  signature?: string;
}

function canonical(envelope: EventEnvelope): string {
  return JSON.stringify({
    eventName: envelope.eventName,
    entityType: envelope.entityType,
    entityId: envelope.entityId,
    source: envelope.source,
    actorId: envelope.actorId ?? null,
    payload: envelope.payload,
  });
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signEnvelope(envelope: EventEnvelope, secret: string): Promise<EventEnvelope> {
  return { ...envelope, signature: await hmac(secret, canonical(envelope)) };
}

export async function verifyEnvelope(envelope: EventEnvelope, secret: string): Promise<boolean> {
  if (!envelope.signature) return false;
  const expected = await hmac(secret, canonical(envelope));
  if (expected.length !== envelope.signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
  return diff === 0;
}

// Producer: publish a domain event to the queue. When EVENTS is unbound (local
// dev without queues) this is a no-op \u2014 domain events are still written to D1 by
// emitDomainEvent. When EVENT_BUS_SECRET is set the envelope is signed.
export async function publishEvent(
  env: Env,
  input: { eventName: string; entityType: string; entityId: string; payload?: Record<string, unknown>; actorId?: string | null }
): Promise<void> {
  if (!env.EVENTS) return;
  let envelope: EventEnvelope = {
    eventName: input.eventName,
    entityType: input.entityType,
    entityId: input.entityId,
    source: "app",
    actorId: input.actorId ?? null,
    payload: input.payload ?? {},
  };
  if (env.EVENT_BUS_SECRET) envelope = await signEnvelope(envelope, env.EVENT_BUS_SECRET);
  await env.EVENTS.send(envelope);
}

// Consumer: route one queue message to the audit sink. Verifies the signature
// first when a secret is configured; drops unverifiable messages.
export async function consumeEvent(env: Env, envelope: EventEnvelope): Promise<{ recorded: boolean }> {
  if (env.EVENT_BUS_SECRET) {
    const valid = await verifyEnvelope(envelope, env.EVENT_BUS_SECRET);
    if (!valid) return { recorded: false };
  }
  await writeAudit(env, envelope.eventName, {
    actorId: envelope.actorId ?? undefined,
    entityType: envelope.entityType,
    entityId: envelope.entityId,
    payload: envelope.payload,
  });
  return { recorded: true };
}
`;
}
function buildHooksTs(composition) {
  return `export interface HookResult<T = unknown> {
  ok: boolean;
  value?: T;
  warnings?: string[];
}

export interface BookingDraft {
  customerId: string;
  serviceType: string;
  startsAt: string;
  endsAt: string;
  metadata?: Record<string, unknown>;
}

export const hookConfig = ${JSON.stringify(composition.config, null, 2)} as const;

export interface MintTokenDraft {
  subject: string;
  scopes: string[];
  ttlSeconds: number;
}

export async function beforeMintToken(input: MintTokenDraft): Promise<HookResult<MintTokenDraft>> {
  return { ok: true, value: input };
}

export async function beforeCustomerCreate<T extends Record<string, unknown>>(input: T): Promise<HookResult<T>> {
  return { ok: true, value: input };
}

export async function beforeBookingCreate(input: BookingDraft): Promise<HookResult<BookingDraft>> {
  return { ok: true, value: input };
}

export async function calculateAvailability(
  input: { serviceType: string; from: string; to: string }
): Promise<HookResult<{ serviceType: string; slots: unknown[]; generatedBy: string }>> {
  return {
    ok: true,
    value: {
      serviceType: input.serviceType,
      slots: [],
      generatedBy: "microservices.sh hook placeholder",
    },
  };
}

export async function afterBookingConfirmed(input: { bookingId: string; customerId: string }) {
  return { ok: true, value: input };
}
`;
}
function buildIndexTs(composition) {
  const PUBLIC_MODULES = /* @__PURE__ */ new Set(["auth", "gateway"]);
  const camel = (id) => id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  const routeImports = composition.modules.map((module) => `import { ${camel(module.id)}Routes } from "./modules/${module.id}";`).join("\n");
  const publicMounts = composition.modules.filter((module) => PUBLIC_MODULES.has(module.id)).map((module) => `app.route("${module.runtime.mount}", ${camel(module.id)}Routes);`).join("\n");
  const businessModules = composition.modules.filter((module) => !PUBLIC_MODULES.has(module.id));
  const businessGuards = businessModules.map((module) => `app.use("${module.runtime.mount}/*", requireToken);`).join("\n");
  const businessMounts = businessModules.map((module) => `app.route("${module.runtime.mount}", ${camel(module.id)}Routes);`).join("\n");
  return `import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Env } from "./lib/env";
import { verifyToken } from "./lib/jwt";
import type { TokenClaims } from "./lib/jwt";
import { consumeEvent } from "./lib/events";
import type { EventEnvelope } from "./lib/events";
${routeImports}

type AppEnv = { Bindings: Env; Variables: { claims: TokenClaims } };

const app = new Hono<AppEnv>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    app: ${JSON.stringify(composition.config.appName ?? composition.template.name)},
    template: ${JSON.stringify(composition.template.id)},
    modules: ${JSON.stringify(composition.modules.map((module) => module.id))},
  })
);

// Front-door guard: business routes require a token minted via /gateway/tokens.
const requireToken = async (c: Context<AppEnv>, next: Next) => {
  const authz = c.req.header("Authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const result = await verifyToken(c.env, token);
  if (!result.ok) {
    return c.json({ ok: false, error: "Unauthorized", code: result.error }, 401);
  }
  c.set("claims", result.claims);
  await next();
};

// Public platform routes (auth, gateway).
${publicMounts}

// Token-gated business routes.
${businessGuards}
${businessMounts}

// Worker entry: HTTP fetch (the Hono app) + the event-bus queue consumer
// (plans/24 layer 3). The consumer verifies each signed envelope and routes it
// to the audit sink. Messages that fail verification are acked (dropped) rather
// than retried.
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<EventEnvelope>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await consumeEvent(env, message.body);
      message.ack();
    }
  },
};
`;
}
function buildJwtTs() {
  return `import type { Env } from "./env";
import { emitDomainEvent } from "./audit";

// EdDSA (Ed25519) service tokens for auth-gated inter-service communication.
// Self-contained WebCrypto implementation; no external JWT dependency.
// The auth service signs with its private key; other services verify with the
// public key published via JWKS. See plans/24.

const ALG = { name: "Ed25519" } as const;

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function base64UrlEncode(input: Uint8Array | string): string {
  const data = typeof input === "string" ? utf8(input) : input;
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export interface TokenClaims {
  sub: string;
  workspace: string;
  project: string;
  scopes: string[];
  iss: string;
  iat: number;
  exp: number;
  jti: string;
}

interface SigningKeyRow {
  kid: string;
  public_jwk: string;
  private_jwk: string;
  status: string;
}

async function importSigningKey(privateJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", privateJwk, ALG, false, ["sign"]);
}

async function importVerifyKey(publicJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", publicJwk, ALG, false, ["verify"]);
}

async function getActiveKey(env: Env): Promise<SigningKeyRow | null> {
  return env.DB.prepare(
    "SELECT kid, public_jwk, private_jwk, status FROM signing_keys WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).first<SigningKeyRow>();
}

async function getKeyByKid(env: Env, kid: string): Promise<SigningKeyRow | null> {
  return env.DB.prepare("SELECT kid, public_jwk, private_jwk, status FROM signing_keys WHERE kid = ?")
    .bind(kid)
    .first<SigningKeyRow>();
}

// Generates a new keypair, retires the previous active key, and promotes it.
export async function rotateSigningKey(env: Env): Promise<{ kid: string; publicJwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const now = new Date().toISOString();
  const kid = "key_" + crypto.randomUUID().slice(0, 12);

  await env.DB.prepare("UPDATE signing_keys SET status = 'retired', retired_at = ? WHERE status = 'active'").bind(now).run();
  await env.DB.prepare(
    "INSERT INTO signing_keys (kid, algorithm, public_jwk, private_jwk, status, created_at, retired_at) VALUES (?, ?, ?, ?, 'active', ?, NULL)"
  )
    .bind(kid, "EdDSA", JSON.stringify(publicJwk), JSON.stringify(privateJwk), now)
    .run();
  await emitDomainEvent(env, "auth.key_rotated", "auth", kid, { kid });
  return { kid, publicJwk };
}

export interface MintInput {
  subject: string;
  scopes: string[];
  ttlSeconds?: number;
  workspace?: string;
  project?: string;
  issuer?: string;
}

export type MintResult =
  | { ok: true; status: 200; token: string; claims: TokenClaims; kid: string }
  | { ok: false; status: number; error: string };

export async function mintToken(env: Env, input: MintInput): Promise<MintResult> {
  const key = await getActiveKey(env);
  if (!key) {
    return { ok: false, status: 500, error: "No active signing key. POST /auth/keys/rotate first." };
  }
  const ttl = Math.min(Math.max(Math.floor(input.ttlSeconds ?? 60), 1), 3600);
  const iat = Math.floor(Date.now() / 1000);
  const claims: TokenClaims = {
    sub: input.subject,
    workspace: input.workspace ?? "default",
    project: input.project ?? "default",
    scopes: input.scopes,
    iss: input.issuer ?? "auth",
    iat,
    exp: iat + ttl,
    jti: "jti_" + crypto.randomUUID().slice(0, 16),
  };
  const header = { alg: "EdDSA", typ: "JWT", kid: key.kid };
  const signingInput = base64UrlEncode(JSON.stringify(header)) + "." + base64UrlEncode(JSON.stringify(claims));
  const signingKey = await importSigningKey(JSON.parse(key.private_jwk) as JsonWebKey);
  const signature = await crypto.subtle.sign(ALG, signingKey, utf8(signingInput));
  const token = signingInput + "." + base64UrlEncode(new Uint8Array(signature));
  await emitDomainEvent(env, "auth.token_minted", "auth", claims.jti, {
    sub: claims.sub,
    scopes: claims.scopes,
  });
  return { ok: true, status: 200, token, claims, kid: key.kid };
}

export type VerifyResult =
  | { ok: true; status: 200; claims: TokenClaims }
  | { ok: false; status: 401; error: string };

export async function verifyToken(env: Env, token: string): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, error: "MALFORMED_TOKEN" };
  let header: { kid?: string };
  let claims: TokenClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  } catch {
    return { ok: false, status: 401, error: "MALFORMED_TOKEN" };
  }
  if (!header.kid) return { ok: false, status: 401, error: "MALFORMED_TOKEN" };
  const key = await getKeyByKid(env, header.kid);
  if (!key) return { ok: false, status: 401, error: "UNKNOWN_KEY" };
  const verifyKey = await importVerifyKey(JSON.parse(key.public_jwk) as JsonWebKey);
  const valid = await crypto.subtle.verify(ALG, verifyKey, base64UrlDecode(parts[2]), utf8(parts[0] + "." + parts[1]));
  if (!valid) return { ok: false, status: 401, error: "INVALID_SIGNATURE" };
  if (claims.exp <= Math.floor(Date.now() / 1000)) return { ok: false, status: 401, error: "TOKEN_EXPIRED" };
  return { ok: true, status: 200, claims };
}

export async function getJwks(env: Env): Promise<{ keys: Array<JsonWebKey & { kid: string; use: string; alg: string }> }> {
  const rows = await env.DB.prepare(
    "SELECT kid, public_jwk FROM signing_keys ORDER BY created_at DESC LIMIT 10"
  ).all<{ kid: string; public_jwk: string }>();
  return {
    keys: (rows.results ?? []).map((row) => ({
      ...(JSON.parse(row.public_jwk) as JsonWebKey),
      kid: row.kid,
      use: "sig",
      alg: "EdDSA",
    })),
  };
}

// Callee-side scope guard: a service checks verified claims against the scope
// its operation requires before executing.
export function requireScope(claims: TokenClaims, scope: string): boolean {
  return claims.scopes.includes(scope);
}
`;
}
function buildAuthModuleTs() {
  return `import { Hono } from "hono";
import type { Env } from "../lib/env";
import { beforeMintToken } from "../lib/hooks";
import { mintToken, verifyToken, getJwks, rotateSigningKey } from "../lib/jwt";

// Token authority for auth-gated inter-service communication (plans/24).
// Replaces the previous passwordless-identity runtime: this service issues and
// verifies short-lived EdDSA tokens and publishes JWKS. Identity/users live
// elsewhere (gateway sessions + customer.external_id mapping).
export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/.well-known/jwks.json", async (c) => {
  return c.json(await getJwks(c.env));
});

authRoutes.post("/keys/rotate", async (c) => {
  const result = await rotateSigningKey(c.env);
  return c.json({ ok: true, ...result }, 201);
});

authRoutes.post("/tokens", async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
  const subject = String(body.subject ?? "").trim();
  if (!subject) {
    return c.json({ ok: false, error: "A token subject is required." }, 400);
  }
  const draft = await beforeMintToken({
    subject,
    scopes: Array.isArray(body.scopes) ? body.scopes.map((scope) => String(scope)) : [],
    ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : 60,
  });
  if (!draft.ok || !draft.value) {
    return c.json({ ok: false, error: "Mint rejected by beforeMintToken hook.", warnings: draft.warnings ?? [] }, 422);
  }
  const result = await mintToken(c.env, {
    subject: draft.value.subject,
    scopes: draft.value.scopes,
    ttlSeconds: draft.value.ttlSeconds,
    workspace: typeof body.workspace === "string" ? body.workspace : undefined,
    project: typeof body.project === "string" ? body.project : undefined,
  });
  return c.json(result, result.status as 200 | 400 | 500);
});

authRoutes.post("/tokens/verify", async (c) => {
  const body = (await c.req.json<{ token?: string }>().catch(() => ({}))) as { token?: string };
  const result = await verifyToken(c.env, String(body.token ?? ""));
  return c.json(result, result.status as 200 | 401);
});
`;
}
function buildGatewayLibTs() {
  return `import type { Env } from "./env";
import { mintToken } from "./jwt";

// Gateway helpers (plans/24): API-key auth, rate limiting, scope narrowing, and
// token exchange. The gateway never signs \u2014 it mints via the auth token lib.

async function hashApiKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "msk_" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ApiKeyRecord {
  id: string;
  workspace: string;
  project: string;
  subject: string;
  scopes: string[];
  status: string;
}

export async function createApiKey(
  env: Env,
  input: { workspace: string; project: string; subject: string; scopes: string[] }
) {
  const raw = generateApiKey();
  const id = "key_" + crypto.randomUUID().slice(0, 12);
  await env.DB.prepare(
    "INSERT INTO api_keys (id, hash, workspace, project, subject, scopes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)"
  )
    .bind(id, await hashApiKey(raw), input.workspace, input.project, input.subject, JSON.stringify(input.scopes), new Date().toISOString())
    .run();
  return { id, apiKey: raw, scopes: input.scopes };
}

async function getByHash(env: Env, hash: string): Promise<ApiKeyRecord | null> {
  const row = await env.DB.prepare(
    "SELECT id, workspace, project, subject, scopes, status FROM api_keys WHERE hash = ?"
  )
    .bind(hash)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    workspace: String(row.workspace),
    project: String(row.project),
    subject: String(row.subject),
    scopes: JSON.parse(String(row.scopes)) as string[],
    status: String(row.status),
  };
}

async function rateLimit(env: Env, identifier: string, limit: number, windowSeconds: number) {
  const bucket = Math.floor(Math.floor(Date.now() / 1000) / windowSeconds);
  const key = "rl:" + identifier + ":" + bucket;
  const count = Number((await env.RATE_LIMIT_KV.get(key)) ?? "0") + 1;
  await env.RATE_LIMIT_KV.put(key, String(count), { expirationTtl: Math.max(windowSeconds, 60) });
  return { allowed: count <= limit, resetAt: new Date((bucket + 1) * windowSeconds * 1000).toISOString() };
}

export type IssueResult =
  | { ok: true; status: 200; token: string; scopes: string[]; claims: unknown }
  | { ok: false; status: 400 | 401 | 403 | 429 | 500; error: string };

export async function issueToken(
  env: Env,
  input: { apiKey?: string; scopes?: string[] },
  config?: { tokenTtlSeconds?: number; rateLimit?: number; rateWindowSeconds?: number }
): Promise<IssueResult> {
  const raw = String(input.apiKey ?? "");
  if (raw.length < 8) return { ok: false, status: 401, error: "INVALID_API_KEY" };
  const record = await getByHash(env, await hashApiKey(raw));
  if (!record || record.status !== "active") return { ok: false, status: 401, error: "UNKNOWN_API_KEY" };

  const rate = await rateLimit(env, "apikey:" + record.id, config?.rateLimit ?? 60, config?.rateWindowSeconds ?? 60);
  if (!rate.allowed) return { ok: false, status: 429, error: "RATE_LIMITED" };

  const granted = new Set(record.scopes);
  const requested = input.scopes ?? record.scopes;
  if (requested.some((scope) => !granted.has(scope))) return { ok: false, status: 403, error: "SCOPE_NOT_GRANTED" };

  const minted = await mintToken(env, {
    subject: record.subject,
    scopes: requested,
    ttlSeconds: config?.tokenTtlSeconds ?? 60,
    workspace: record.workspace,
    project: record.project,
  });
  if (!minted.ok) return { ok: false, status: 500, error: minted.error };
  return { ok: true, status: 200, token: minted.token, scopes: requested, claims: minted.claims };
}
`;
}
function buildGatewayModuleTs() {
  return `import { Hono } from "hono";
import type { Env } from "../lib/env";
import { createApiKey, issueToken } from "../lib/gateway";
import { verifyToken, requireScope } from "../lib/jwt";

// Public trust boundary (plans/24). Issues short-lived tokens from API keys and
// manages keys (admin-gated). Business routes elsewhere require the issued token.
export const gatewayRoutes = new Hono<{ Bindings: Env }>();

gatewayRoutes.post("/tokens", async (c) => {
  const body = (await c.req.json<{ apiKey?: string; scopes?: string[] }>().catch(() => ({}))) as {
    apiKey?: string;
    scopes?: string[];
  };
  const result = await issueToken(c.env, body);
  return c.json(result, result.status);
});

gatewayRoutes.post("/keys", async (c) => {
  const authz = c.req.header("Authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const verified = await verifyToken(c.env, token);
  if (!verified.ok) return c.json({ ok: false, error: "Unauthorized" }, 401);
  if (!requireScope(verified.claims, "gateway.admin")) {
    return c.json({ ok: false, error: "Forbidden: gateway.admin scope required." }, 403);
  }
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.workspace !== "string" || typeof body.project !== "string" || typeof body.subject !== "string") {
    return c.json({ ok: false, error: "workspace, project, and subject are required." }, 400);
  }
  const created = await createApiKey(c.env, {
    workspace: body.workspace,
    project: body.project,
    subject: body.subject,
    scopes: Array.isArray(body.scopes) ? body.scopes.map((scope) => String(scope)) : [],
  });
  return c.json({ ok: true, ...created }, 201);
});
`;
}
function buildCustomerModuleTs() {
  return `import { Hono } from "hono";
import type { Env } from "../lib/env";
import { emitDomainEvent, writeAudit } from "../lib/audit";
import { beforeCustomerCreate } from "../lib/hooks";

export const customerRoutes = new Hono<{ Bindings: Env }>();

customerRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, external_id, name, email, phone, notes, tags, created_at, updated_at FROM customers ORDER BY created_at DESC LIMIT 50"
  ).all();
  return c.json({ ok: true, customers: rows.results ?? [] });
});

customerRoutes.post("/", async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
  const draft = await beforeCustomerCreate({
    externalId: typeof body.externalId === "string" ? body.externalId : null,
    name: String(body.name ?? "").trim(),
    email: String(body.email ?? "").trim().toLowerCase(),
    phone: typeof body.phone === "string" ? body.phone : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    tags: Array.isArray(body.tags) ? body.tags : [],
  });

  if (!draft.ok || !draft.value?.name || !String(draft.value.email).includes("@")) {
    return c.json({ ok: false, error: "Customer name and valid email are required.", warnings: draft.warnings ?? [] }, 400);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    "INSERT INTO customers (id, external_id, name, email, phone, notes, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      draft.value.externalId,
      draft.value.name,
      draft.value.email,
      draft.value.phone,
      draft.value.notes,
      JSON.stringify(draft.value.tags),
      now,
      now
    )
    .run();

  await emitDomainEvent(c.env, "customer.created", "customer", id, draft.value);
  await writeAudit(c.env, "customer.created", {
    entityType: "customer",
    entityId: id,
    payload: draft.value,
  });

  return c.json({ ok: true, customer: { id, ...draft.value } }, 201);
});
`;
}
function buildBookingModuleTs() {
  return `import { Hono } from "hono";
import type { Env } from "../lib/env";
import { emitDomainEvent, writeAudit } from "../lib/audit";
import { afterBookingConfirmed, beforeBookingCreate, calculateAvailability } from "../lib/hooks";

export const bookingRoutes = new Hono<{ Bindings: Env }>();

bookingRoutes.get("/availability", async (c) => {
  const serviceType = c.req.query("serviceType") ?? "standard-service";
  const from = c.req.query("from") ?? new Date().toISOString();
  const to = c.req.query("to") ?? from;
  const availability = await calculateAvailability({ serviceType, from, to });
  return c.json({ ok: true, availability: availability.value, warnings: availability.warnings ?? [] });
});

bookingRoutes.post("/", async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
  const draft = await beforeBookingCreate({
    customerId: String(body.customerId ?? ""),
    serviceType: String(body.serviceType ?? "standard-service"),
    startsAt: String(body.startsAt ?? ""),
    endsAt: String(body.endsAt ?? ""),
    metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata as Record<string, unknown> : {},
  });

  if (!draft.ok || !draft.value?.customerId || !draft.value.startsAt || !draft.value.endsAt) {
    return c.json({ ok: false, error: "customerId, startsAt, and endsAt are required.", warnings: draft.warnings ?? [] }, 400);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    "INSERT INTO bookings (id, customer_id, service_type, status, starts_at, ends_at, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      draft.value.customerId,
      draft.value.serviceType,
      "confirmed",
      draft.value.startsAt,
      draft.value.endsAt,
      JSON.stringify(draft.value.metadata ?? {}),
      now,
      now
    )
    .run();

  await afterBookingConfirmed({ bookingId: id, customerId: draft.value.customerId });
  await emitDomainEvent(c.env, "booking.confirmed", "booking", id, draft.value);
  await writeAudit(c.env, "booking.confirmed", {
    entityType: "booking",
    entityId: id,
    payload: draft.value,
  });

  return c.json({ ok: true, booking: { id, status: "confirmed", ...draft.value } }, 201);
});
`;
}
function buildAgentReadme(composition) {
  const moduleList = composition.modules.map((module) => `- ${module.name} (${module.id}) at ${module.runtime.mount}`).join("\n");
  const hookList = composition.hooks.map((hook) => `- ${hook.name}: ${hook.purpose}`).join("\n");
  return `# ${composition.config.appName ?? composition.template.name}

Generated by microservices.sh local MVP tooling.

## Modules
${moduleList}

## Safe Customization
Use configuration and hooks before editing module route internals.

Hooks live in \`src/lib/hooks.ts\`:
${hookList}

## Audit And Events
Domain events are written to \`domain_events\`.
Audit events are written to \`audit_events\`.
Every generated mutation should emit both a domain event and an audit event.

## Local Commands
\`\`\`bash
pnpm install
pnpm microservices modules list --json
pnpm microservices docs booking
pnpm microservices upgrade booking --plan --json
pnpm microservices check --json
pnpm db:init
pnpm dev
\`\`\`

Use \`pnpm microservices add <module-id> --plan --json\` before installing planned provider modules.
Use \`pnpm microservices upgrade <module-id> --plan --json\` before updating a locked module.

## Deploy
Create D1/KV resources, replace IDs in \`wrangler.jsonc\`, then run:

\`\`\`bash
pnpm deploy
\`\`\`
`;
}
function buildProjectCliJs() {
  const script = `#!/usr/bin/env node
	import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
	import { spawnSync } from "node:child_process";
	import { homedir } from "node:os";
	import { join } from "node:path";

	const DEFAULT_API_URL = "https://api.microservices.sh";
	const TELEMETRY_API_URL = process.env.MICROSERVICES_API_URL || DEFAULT_API_URL;
	const TELEMETRY_TIMEOUT_MS = 1500;
	const TELEMETRY_CONFIG_DIR = process.env.MICROSERVICES_CONFIG_DIR || join(homedir(), ".microservices");
	const TELEMETRY_NOTICE_MARKER = join(TELEMETRY_CONFIG_DIR, ".telemetry-notice");

	function parseArgs(argv) {
	  const args = [];
	  const flags = { json: false, plan: false, version: null, to: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") flags.json = true;
    else if (value === "--plan") flags.plan = true;
    else if (value === "--version") {
      flags.version = argv[index + 1] ?? null;
      index += 1;
    } else if (value === "--to" || value === "--target-version") {
      flags.to = argv[index + 1] ?? null;
      index += 1;
    }
    else args.push(value);
  }
  return { args, flags };
}

	function readJson(path, fallback = null) {
	  if (!existsSync(path)) return fallback;
	  return JSON.parse(readFileSync(path, "utf8"));
	}

	function telemetryEnabled() {
	  const v = String(process.env.MICROSERVICES_TELEMETRY ?? "").toLowerCase();
	  if (["0", "false", "off", "no"].includes(v)) return false;
	  const dnt = String(process.env.DO_NOT_TRACK ?? "").toLowerCase();
	  if (dnt === "1" || dnt === "true") return false;
	  return true;
	}

	function telemetryNotice(json) {
	  if (json || !telemetryEnabled()) return;
	  try {
	    if (existsSync(TELEMETRY_NOTICE_MARKER)) return;
	    mkdirSync(TELEMETRY_CONFIG_DIR, { recursive: true });
	    writeFileSync(TELEMETRY_NOTICE_MARKER, "shown\\n", "utf8");
	    process.stderr.write("microservices collects anonymous usage to improve the tool - no code, paths, or personal data. Opt out: MICROSERVICES_TELEMETRY=0\\n");
	  } catch {
	    // Never let the notice break the project CLI.
	  }
	}

	async function track(name, props = {}) {
	  if (!telemetryEnabled()) return;
	  try {
	    await fetch(TELEMETRY_API_URL + "/events", {
	      method: "POST",
	      headers: { "content-type": "application/json" },
	      body: JSON.stringify({ name, props, session: "workspace-cli" }),
	      signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS)
	    });
	  } catch {
	    // Telemetry is best-effort; never surface failures.
	  }
	}

	function durationMs(startedAt) {
	  return Math.max(0, Date.now() - startedAt);
	}

	function telemetryProps(flags, extra = {}) {
	  const lock = lockfile();
	  const manifest = readJson("microservices.template.json", {});
	  return {
	    source: "workspace-cli",
	    template: manifest.id ?? lock.template ?? null,
	    moduleCount: (lock.modules ?? []).length,
	    json: flags.json,
	    ...extra
	  };
	}

	function catalog() {
	  return readJson("docs/modules/catalog.json", { modules: [] });
	}

function lockfile() {
  return readJson("microservices.lock.json", { modules: [] });
}

function ok(data, warnings = []) {
  return { ok: true, data, warnings };
}

function fail(message, remediation, details = {}) {
  return { ok: false, error: { message, remediation, details } };
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\\n");
}

function parseModuleSelector(value, explicitVersion = null) {
  const raw = String(value ?? "").trim();
  const at = raw.lastIndexOf("@");
  const selector = at > 0
    ? { id: raw.slice(0, at), version: raw.slice(at + 1) || null }
    : { id: raw, version: null };
  const flagVersion = explicitVersion ? String(explicitVersion).trim() : null;
  if (selector.version && flagVersion && selector.version !== flagVersion) {
    return {
      ok: false,
      response: fail("Conflicting module versions.", "Use either module@version or --version/--to, not both with different versions.", {
        moduleId: selector.id,
        inlineVersion: selector.version,
        explicitVersion: flagVersion,
      }),
    };
  }
  return { ok: true, id: selector.id, version: flagVersion ?? selector.version };
}

function resolveModule(id, explicitVersion = null) {
  const selector = parseModuleSelector(id, explicitVersion);
  if (!selector.ok) return selector;
  const candidates = catalog().modules.filter((module) => module.id === selector.id);
  if (!candidates.length) {
    return {
      ok: false,
      response: fail("Unknown module.", "Run pnpm microservices modules list --json and pick a returned id.", { id: selector.id }),
    };
  }
  const module = selector.version
    ? candidates.find((candidate) => candidate.version === selector.version)
    : candidates[candidates.length - 1];
  if (!module) {
    return {
      ok: false,
      response: fail("Requested module version is not available.", "Use one of the available versions or omit the version.", {
        moduleId: selector.id,
        requestedVersion: selector.version,
        availableVersions: candidates.map((candidate) => candidate.version),
      }),
    };
  }
  return { ok: true, module, selector: { id: selector.id, version: selector.version }, availableVersions: candidates.map((candidate) => candidate.version) };
}

function compareVersions(a, b) {
  if (a === b) return 0;
  const left = String(a ?? "").match(/^(\\d+)\\.(\\d+)\\.(\\d+)(?:[-+].*)?$/);
  const right = String(b ?? "").match(/^(\\d+)\\.(\\d+)\\.(\\d+)(?:[-+].*)?$/);
  if (left && right) {
    for (let index = 1; index <= 3; index += 1) {
      const l = Number(left[index]);
      const r = Number(right[index]);
      if (l !== r) return l < r ? -1 : 1;
    }
    return 0;
  }
  return String(a) < String(b) ? -1 : 1;
}

function versionDirection(currentVersion, targetVersion) {
  const comparison = compareVersions(currentVersion, targetVersion);
  if (comparison < 0) return "upgrade";
  if (comparison > 0) return "downgrade";
  return "none";
}

function findModule(id, explicitVersion = null) {
  const result = resolveModule(id, explicitVersion);
  return result.ok ? result.module : null;
}

function modulePlan(id, flags = {}) {
  const resolved = resolveModule(id, flags.version);
  if (!resolved.ok) return resolved.response;
  const module = resolved.module;
  const lock = lockfile();
  const installed = new Set((lock.modules ?? []).map((item) => item.id));
  const missingDependencies = (module.requires ?? []).filter((item) => !installed.has(item));
  const alreadyInstalled = installed.has(module.id);
  const gated = module.approvalRisk === "high" || (module.secrets ?? []).length > 0 || module.status !== "available";

  return ok({
    module,
    requestedVersion: resolved.selector.version ?? module.version,
    availableVersions: resolved.availableVersions,
    sourceRef: module.sourceRef ?? null,
    action: alreadyInstalled ? "already-installed" : module.status === "available" ? "install" : "planned-install",
    alreadyInstalled,
    missingDependencies,
    approvalRequired: gated,
    requiredSecrets: module.secrets ?? [],
    requiredResources: module.resources ?? [],
    requiredPermissions: module.permissions ?? [],
    filesLikelyTouched: [
      "microservices.lock.json",
      "wrangler.jsonc",
      "schema.sql",
      "src/index.ts",
      "src/modules/" + module.id + ".ts",
      "docs/modules/" + module.id + ".md",
    ],
    nextSteps: [
      "Review this plan with the user.",
      "Confirm gated side effects before changing secrets, resources, webhooks, migrations, or deploy settings.",
      "Apply generated code changes only after approval.",
      "Run pnpm microservices check --json and pnpm typecheck after changes.",
    ],
  }, module.status === "planned" ? ["Module is planned; this command produces a plan only."] : []);
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function stringDiff(fromValues, toValues, hasSnapshot) {
  const from = hasSnapshot ? new Set(asStringArray(fromValues)) : new Set();
  const to = new Set(asStringArray(toValues));
  return {
    added: hasSnapshot ? Array.from(to).filter((item) => !from.has(item)) : [],
    removed: hasSnapshot ? Array.from(from).filter((item) => !to.has(item)) : [],
    unchanged: Array.from(to).filter((item) => from.has(item)),
    snapshotAvailable: hasSnapshot,
  };
}

function customizationMatches(value, moduleId) {
  if (typeof value === "string") return value === moduleId || value.startsWith(moduleId + ":") || value.startsWith(moduleId + "/");
  if (value && typeof value === "object") {
    return value.module === moduleId || value.moduleId === moduleId || value.id === moduleId;
  }
  return false;
}

function matchingCustomizations(items, moduleId) {
  return Array.isArray(items) ? items.filter((item) => customizationMatches(item, moduleId)) : [];
}

function targetContract(module) {
  return {
    mount: module.mount,
    resources: module.resources ?? [],
    permissions: module.permissions ?? [],
    hooks: module.hooks ?? [],
    events: module.events ?? [],
    requires: module.requires ?? [],
    secrets: module.secrets ?? [],
  };
}

function filesForUpgrade(module, diff) {
  const files = new Set(["microservices.lock.json", "docs/modules/" + module.id + ".md"]);
  if (module.status === "available") files.add("src/modules/" + module.id + ".ts");
  if (diff.resources.added.length || diff.resources.removed.length || (module.secrets ?? []).length) files.add("wrangler.jsonc");
  if ((module.resources ?? []).some((resource) => String(resource).toLowerCase().includes("d1"))) files.add("schema.sql");
  if (diff.hooks.added.length || diff.hooks.removed.length || (module.hooks ?? []).length) files.add("src/lib/hooks.ts");
  return Array.from(files);
}

function upgradePlan(id, flags = {}) {
  const resolved = resolveModule(id, flags.to ?? flags.version);
  if (!resolved.ok) return resolved.response;
  const module = resolved.module;

  const lock = lockfile();
  const locked = (lock.modules ?? []).find((item) => item.id === resolved.selector.id);
  if (!locked) {
    return fail("Module is not installed.", "Run pnpm microservices modules list --json, then plan an upgrade for an installed module.", { id: resolved.selector.id });
  }

  const hasSnapshot = Boolean(locked.contract && typeof locked.contract === "object");
  const currentContract = locked.contract ?? {};
  const nextContract = targetContract(module);
  const direction = versionDirection(locked.version, module.version);
  const versionChangeAvailable = direction !== "none";
  const diff = {
    mount: hasSnapshot && currentContract.mount !== nextContract.mount
      ? { from: currentContract.mount ?? null, to: nextContract.mount }
      : { from: currentContract.mount ?? nextContract.mount, to: nextContract.mount },
    resources: stringDiff(currentContract.resources, nextContract.resources, hasSnapshot),
    permissions: stringDiff(currentContract.permissions, nextContract.permissions, hasSnapshot),
    hooks: stringDiff(currentContract.hooks, nextContract.hooks, hasSnapshot),
    events: stringDiff(currentContract.events, nextContract.events, hasSnapshot),
    requires: stringDiff(currentContract.requires, nextContract.requires, hasSnapshot),
    secrets: {
      added: versionChangeAvailable ? nextContract.secrets : [],
      removed: [],
      unchanged: versionChangeAvailable ? [] : nextContract.secrets,
      snapshotAvailable: false,
    },
  };
  const customizations = lock.customizations ?? {};
  const customizationImpact = {
    configPreserved: customizations.config !== false,
    hooksToReview: module.hooks ?? [],
    overlaysToReview: matchingCustomizations(customizations.overlays, module.id),
    forksToReview: matchingCustomizations(customizations.forks, module.id),
  };
  const hasForks = customizationImpact.forksToReview.length > 0;
  const hasOverlays = customizationImpact.overlaysToReview.length > 0;
  const changesResources = diff.resources.added.length > 0 || diff.resources.removed.length > 0;
  const changesPermissions = diff.permissions.added.length > 0 || diff.permissions.removed.length > 0;
  const changesSecrets = diff.secrets.added.length > 0 || diff.secrets.removed.length > 0;
  const approvalRequired = versionChangeAvailable && (
    module.approvalRisk === "high" || changesSecrets || changesResources || changesPermissions || hasForks || hasOverlays
  );
  const risk = !versionChangeAvailable
    ? "low"
    : approvalRequired || hasForks
      ? "high"
      : hasOverlays || diff.hooks.added.length || diff.hooks.removed.length
        ? "medium"
        : "low";

  return ok({
    module: {
      id: module.id,
      name: module.name,
      status: module.status,
      currentVersion: locked.version,
      targetVersion: module.version,
      requestedVersion: resolved.selector.version ?? module.version,
      availableVersions: resolved.availableVersions,
    },
    action: direction === "none" ? "no-op" : direction + "-plan",
    direction,
    upgradeAvailable: versionChangeAvailable,
    versionChangeAvailable,
    approvalRequired,
    risk,
    lockfile: {
      schemaVersion: lock.schemaVersion ?? null,
      registryVersion: catalog().schemaVersion ?? null,
      template: lock.template ?? null,
      source: locked.source ?? null,
      checksum: locked.checksum ?? null,
      sourceRef: locked.sourceRef ?? null,
      targetSourceRef: module.sourceRef ?? null,
      contractSnapshotAvailable: hasSnapshot,
    },
    diff,
    customizationImpact,
    filesLikelyTouched: versionChangeAvailable ? filesForUpgrade(module, diff) : [],
    permissionGate: {
      required: approvalRequired,
      reasons: [
        module.approvalRisk === "high" ? "high-risk module" : null,
        changesSecrets ? "secret changes" : null,
        changesResources ? "resource changes" : null,
        changesPermissions ? "permission changes" : null,
        hasOverlays ? "overlay customizations require merge review" : null,
        hasForks ? "forked module requires manual merge review" : null,
      ].filter(Boolean),
    },
    nextSteps: versionChangeAvailable
      ? [
          "Review this plan with the user before modifying source.",
          "Create a branch or patch for the " + direction + ".",
          "Review hook, overlay, and fork impacts before applying generated changes.",
          "Run pnpm microservices check --json and pnpm typecheck after applying.",
          "Deploy preview only after approval for resources, migrations, webhooks, or secrets.",
        ]
      : [
          "The installed module already matches the requested registry version.",
          "Run microservices updates --json later to check again.",
        ],
  });
}

function updates() {
  const lock = lockfile();
  const modules = catalog().modules;
  const byId = new Map(modules.map((module) => [module.id, module]));
  const current = [];
  const unavailable = [];

  for (const locked of lock.modules ?? []) {
    const registryModule = byId.get(locked.id);
    if (!registryModule) {
      unavailable.push({ id: locked.id, currentVersion: locked.version, reason: "No matching catalog module." });
      continue;
    }
    const direction = versionDirection(locked.version, registryModule.version);
    current.push({
      id: locked.id,
      currentVersion: locked.version,
      latestVersion: registryModule.version,
      availableVersions: modules.filter((module) => module.id === locked.id).map((module) => module.version),
      direction,
      status: direction === "none" ? "current" : "update-available",
    });
  }

  return ok({
    schemaVersion: lock.schemaVersion ?? null,
    registryVersion: catalog().schemaVersion ?? null,
    template: lock.template ?? null,
    current,
    available: current.filter((item) => item.status === "update-available"),
    unavailable,
    policy: lock.customizations ?? {
      config: true,
      hooks: [],
      overlays: [],
      forks: [],
    },
  });
}

function secretsStatus() {
  const installedIds = new Set((lockfile().modules ?? []).map((item) => item.id));
  const modules = catalog().modules.filter((module) => installedIds.has(module.id) || (module.secrets ?? []).length > 0);
  return ok({
    secrets: modules.flatMap((module) =>
      (module.secrets ?? []).map((name) => ({
        module: module.id,
        name,
        configured: false,
        scope: "project/env/module/" + module.id + "/" + name,
        valueVisibleToAgent: false,
      }))
    ),
  });
}

function checks() {
  const requiredFiles = [
    "package.json",
    "wrangler.jsonc",
    "schema.sql",
    "microservices.lock.json",
    "docs/llms.txt",
    "docs/modules/catalog.json",
    "src/index.ts",
    "src/lib/hooks.ts",
  ];
  const result = requiredFiles.map((path) => ({
    id: "file:" + path,
    status: existsSync(path) ? "pass" : "fail",
    message: existsSync(path) ? path + " exists." : path + " is missing.",
  }));
  return ok({
    status: result.every((item) => item.status === "pass") ? "pass" : "fail",
    checks: result,
  });
}

function usage() {
  return "microservices project CLI\\n\\n" +
    "Usage:\\n" +
    "  pnpm microservices modules list [--json]\\n" +
    "  pnpm microservices modules inspect <id[@version]> [--version x] [--json]\\n" +
    "  pnpm microservices docs <id[@version]> [--version x] [--json]\\n" +
    "  pnpm microservices add <id[@version]> --plan [--version x] [--json]\\n" +
    "  pnpm microservices secrets status [--json]\\n" +
    "  pnpm microservices updates [--json]\\n" +
    "  pnpm microservices upgrade <id[@version]> --plan [--to x] [--json]\\n" +
    "  pnpm microservices check [--json]\\n" +
    "  pnpm microservices dev\\n";
}

const { args, flags } = parseArgs(process.argv.slice(2));
const [resource, action, value] = args;
let response;

	if (!resource || resource === "help" || resource === "--help" || resource === "-h") {
	  process.stdout.write(usage());
	} else if (resource === "modules" && action === "list") {
	  telemetryNotice(flags.json);
	  response = ok(catalog().modules);
	  flags.json ? writeJson(response) : process.stdout.write(response.data.map((module) => module.id + " (" + module.status + ") - " + module.summary).join("\\n") + "\\n");
	} else if (resource === "modules" && action === "inspect") {
	  telemetryNotice(flags.json);
	  const resolved = resolveModule(value, flags.version);
	  response = resolved.ok ? ok(resolved.module) : resolved.response;
	  flags.json ? writeJson(response) : process.stdout.write(response.ok ? response.data.name + "\\n" + response.data.summary + "\\nMount: " + response.data.mount + "\\nStatus: " + response.data.status + "\\n" : "Error: " + response.error.message + "\\n");
	} else if (resource === "docs") {
	  telemetryNotice(flags.json);
	  const resolved = resolveModule(action, flags.version);
	  if (!resolved.ok) {
	    response = resolved.response;
  } else if (!existsSync(resolved.module.docPath)) {
    response = fail("Module doc is missing.", "Regenerate the app or check docs/modules/catalog.json.", { path: resolved.module.docPath });
  } else {
    response = ok({ id: resolved.module.id, path: resolved.module.docPath, markdown: readFileSync(resolved.module.docPath, "utf8") });
	  }
	  flags.json ? writeJson(response) : process.stdout.write(response.ok ? response.data.markdown : "Error: " + response.error.message + "\\n");
	} else if (resource === "add") {
	  telemetryNotice(flags.json);
	  if (!flags.plan) {
	    response = fail("Add requires --plan in the MVP scaffold.", "Run pnpm microservices add <module-id> --plan --json.", { id: action });
	  } else {
	    response = modulePlan(action, flags);
	  }
	  if (response.ok) {
	    await track("module_add_planned", telemetryProps(flags, { moduleId: action ?? null }));
	  } else {
	    await track("module_add_plan_failed", telemetryProps(flags, { moduleId: action ?? null, errorCode: "MODULE_ADD_PLAN_FAILED" }));
	  }
	  flags.json ? writeJson(response) : process.stdout.write(response.ok ? "Plan for " + response.data.module.id + ": " + response.data.action + "\\nApproval required: " + response.data.approvalRequired + "\\n" : "Error: " + response.error.message + "\\n");
	} else if (resource === "secrets" && action === "status") {
	  telemetryNotice(flags.json);
	  response = secretsStatus();
	  flags.json ? writeJson(response) : process.stdout.write((response.data.secrets.map((item) => item.module + ":" + item.name + " configured=" + item.configured).join("\\n") || "No required secrets for installed modules.") + "\\n");
	} else if (resource === "updates") {
	  telemetryNotice(flags.json);
	  response = updates();
	  flags.json ? writeJson(response) : process.stdout.write((response.data.current.map((item) => item.id + ": " + item.currentVersion + " -> " + item.latestVersion + " (" + item.status + ")").join("\\n") || "No locked modules.") + "\\n");
	} else if (resource === "upgrade") {
	  telemetryNotice(flags.json);
	  if (!flags.plan) {
	    response = fail("Upgrade requires --plan in the MVP scaffold.", "Run pnpm microservices upgrade <module-id> --plan --json.", { id: action });
	  } else {
    response = upgradePlan(action, flags);
	  }
	  flags.json ? writeJson(response) : process.stdout.write(response.ok ? "Upgrade plan for " + response.data.module.id + ": " + response.data.action + "\\nApproval required: " + response.data.approvalRequired + "\\nRisk: " + response.data.risk + "\\n" : "Error: " + response.error.message + "\\n");
	} else if (resource === "check") {
	  telemetryNotice(flags.json);
	  response = checks();
	  await track(response.ok ? "check_passed" : "check_failed", telemetryProps(flags, { status: response.data?.status ?? "unknown" }));
	  flags.json ? writeJson(response) : process.stdout.write(response.data.status + "\\n" + response.data.checks.map((item) => "- " + item.id + ": " + item.status).join("\\n") + "\\n");
	} else if (resource === "dev") {
	  telemetryNotice(flags.json);
	  const startedAt = Date.now();
	  await track("workspace_start_attempted", telemetryProps(flags, { kind: "pnpm_dev" }));
	  const child = spawnSync("pnpm", ["dev"], { stdio: "inherit" });
	  const ok = (child.status ?? 1) === 0;
	  await track(ok ? "workspace_start_completed" : "workspace_start_failed", telemetryProps(flags, { kind: "pnpm_dev", exitCode: child.status ?? 1, durationMs: durationMs(startedAt) }));
	  process.exitCode = child.status ?? 1;
	} else {
  process.stderr.write(usage());
  process.exitCode = 1;
}
`;
  return script + "\n";
}
function buildProjectFiles(composition) {
  const catalog = moduleCatalog();
  return [
    { path: "package.json", contents: buildPackageJson(composition) },
    { path: "tsconfig.json", contents: buildTsConfig() },
    { path: "wrangler.jsonc", contents: buildWranglerJson(composition) },
    { path: "schema.sql", contents: buildSchemaSql() },
    { path: "microservices.lock.json", contents: json(composition.lock) },
    { path: "microservices.config.json", contents: buildMicroservicesConfig(composition) },
    { path: "README.agent.md", contents: buildAgentReadme(composition) },
    { path: "docs/llms.txt", contents: buildLlmGuide(composition) },
    { path: "docs/modules/catalog.json", contents: json(catalog) },
    ...catalog.modules.map((module) => ({ path: docPathFor(module.id), contents: moduleDocMarkdown(module) })),
    { path: "scripts/microservices.js", contents: buildProjectCliJs() },
    { path: "src/index.ts", contents: buildIndexTs(composition) },
    { path: "src/lib/env.ts", contents: buildEnvTs() },
    { path: "src/lib/audit.ts", contents: buildAuditTs() },
    { path: "src/lib/events.ts", contents: buildEventsTs() },
    { path: "src/lib/jwt.ts", contents: buildJwtTs() },
    { path: "src/lib/gateway.ts", contents: buildGatewayLibTs() },
    { path: "src/lib/hooks.ts", contents: buildHooksTs(composition) },
    { path: "src/modules/auth.ts", contents: buildAuthModuleTs() },
    { path: "src/modules/gateway.ts", contents: buildGatewayModuleTs() },
    { path: "src/modules/customer.ts", contents: buildCustomerModuleTs() },
    { path: "src/modules/booking.ts", contents: buildBookingModuleTs() }
  ];
}
function listTemplates2() {
  return capture(() => listTemplates());
}
function inspectTemplate2(id) {
  return capture(() => inspectTemplate(id));
}
function listModules2() {
  return capture(() => listModules());
}
function inspectModule2(id) {
  return capture(() => inspectModule(id));
}
function listModuleDocs() {
  return capture(
    () => moduleCatalog().modules.map((module) => ({
      id: module.id,
      name: module.name,
      status: module.status,
      docPath: module.docPath,
      summary: module.summary,
      approvalRisk: module.approvalRisk
    }))
  );
}
function getModuleDoc(id) {
  return capture(() => {
    const module = findCatalogModule(id);
    return {
      id: module.id,
      path: module.docPath,
      markdown: moduleDocMarkdown(module),
      module
    };
  });
}
function composeApp2(input = {}) {
  return capture(() => composeApp(input));
}
function lockedModuleIds(input = {}) {
  const lock = input.lock && typeof input.lock === "object" ? input.lock : null;
  if (Array.isArray(input.installedModules)) return input.installedModules;
  if (lock && Array.isArray(lock.modules)) return lock.modules.map((module) => module.id);
  if (input.templateId || input.template || input.modules || input.config) {
    return composeApp(input).modules.map((module) => module.id);
  }
  return composeApp({ templateId: "booking-business" }).modules.map((module) => module.id);
}
function moduleLock(input = {}) {
  if (input.lock && typeof input.lock === "object") return input.lock;
  return composeApp(input).lock;
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function stringDiff(fromValues, toValues, hasSnapshot = true) {
  const from = hasSnapshot ? new Set(asStringArray(fromValues)) : /* @__PURE__ */ new Set();
  const to = new Set(asStringArray(toValues));
  return {
    added: hasSnapshot ? [...to].filter((item) => !from.has(item)) : [],
    removed: hasSnapshot ? [...from].filter((item) => !to.has(item)) : [],
    unchanged: [...to].filter((item) => from.has(item)),
    snapshotAvailable: hasSnapshot
  };
}
function customizationMatches(value, moduleId) {
  if (typeof value === "string") return value === moduleId || value.startsWith(`${moduleId}:`) || value.startsWith(`${moduleId}/`);
  if (value && typeof value === "object") {
    return value.module === moduleId || value.moduleId === moduleId || value.id === moduleId;
  }
  return false;
}
function matchingCustomizations(items, moduleId) {
  return Array.isArray(items) ? items.filter((item) => customizationMatches(item, moduleId)) : [];
}
function targetContract(module) {
  return {
    mount: module.mount,
    resources: module.resources,
    permissions: module.permissions,
    hooks: module.hooks,
    events: module.events,
    requires: module.requires,
    secrets: module.secrets
  };
}
function filesForUpgrade(module, diff) {
  const files = /* @__PURE__ */ new Set(["microservices.lock.json", `docs/modules/${module.id}.md`]);
  if (module.status === "available") {
    files.add(`src/modules/${module.id}.ts`);
  }
  if (diff.resources.added.length || diff.resources.removed.length || module.secrets.length) {
    files.add("wrangler.jsonc");
  }
  if (module.resources.some((resource) => resource.toLowerCase().includes("d1"))) {
    files.add("schema.sql");
  }
  if (diff.hooks.added.length || diff.hooks.removed.length || module.hooks.length) {
    files.add("src/lib/hooks.ts");
  }
  return [...files];
}
function planAddModule(input = {}) {
  return capture(() => {
    const options = typeof input === "string" ? { moduleId: input } : input;
    const request = moduleRequest(options, ["version", "targetVersion", "to"]);
    if (!request.id) {
      const error = new Error("Missing module id.");
      error.code = "MODULE_ID_REQUIRED";
      error.remediation = "Pass a module id such as payment-stripe.";
      throw error;
    }
    const requestedMode = options.mode ?? "embedded";
    if (requestedMode !== "embedded" && requestedMode !== "service") {
      const error = new Error(`Unknown deploy mode: ${requestedMode}.`);
      error.code = "INVALID_DEPLOY_MODE";
      error.remediation = "Use --mode embedded (default) or --mode service.";
      throw error;
    }
    const module = findCatalogModule(request.id, request.version);
    const installed = new Set(lockedModuleIds(options));
    const alreadyInstalled = installed.has(module.id);
    const missingDependencies = module.requires.filter((id) => !installed.has(id));
    const availableVersions = catalogVersions(module.id);
    const serviceWorker = `app_<project>_${module.id}_<env>`;
    const serviceD1Binding = `${module.id.replace(/-/g, "_").toUpperCase()}_DB`;
    const serviceBindingCallers = [
      "gateway",
      ...moduleCatalog().modules.filter((candidate) => (candidate.requires ?? []).includes(module.id)).map((candidate) => candidate.id)
    ].filter((id, index, all) => all.indexOf(id) === index && id !== module.id);
    const filesLikelyTouched = requestedMode === "service" ? [
      "microservices.lock.json",
      "microservices.config.json",
      `services/${module.id}/wrangler.jsonc`,
      `services/${module.id}/migrations/0001_${module.id}.sql`,
      `services/${module.id}/src/index.ts`,
      `services/${module.id}/src/rpc.ts`,
      "packages/contracts/index.ts",
      ...serviceBindingCallers.map((caller) => `services/${caller}/wrangler.jsonc`),
      `docs/modules/${module.id}.md`
    ] : [
      "microservices.lock.json",
      "microservices.config.json",
      "wrangler.jsonc",
      "schema.sql",
      "src/index.ts",
      `src/modules/${module.id}.ts`,
      `docs/modules/${module.id}.md`
    ];
    const deploy = requestedMode === "service" ? {
      mode: "service",
      ownDatabase: true,
      worker: serviceWorker,
      d1Binding: serviceD1Binding,
      serviceBindingCallers,
      rpc: module.rpc ?? []
    } : {
      mode: "embedded",
      ownDatabase: false,
      sharedDatabaseBinding: "DB",
      rpc: module.rpc ?? []
    };
    return {
      module,
      requestedVersion: request.version ?? module.version,
      availableVersions,
      sourceRef: module.sourceRef,
      mode: requestedMode,
      action: alreadyInstalled ? "already-installed" : module.status === "available" ? "install" : "planned-install",
      alreadyInstalled,
      missingDependencies,
      // Service mode provisions a new D1, so it is approval-gated even for
      // low-risk modules.
      approvalRequired: module.approvalRisk === "high" || module.secrets.length > 0 || module.status !== "available" || requestedMode === "service",
      requiredSecrets: module.secrets,
      requiredResources: module.resources,
      requiredPermissions: module.permissions,
      deploy,
      lockEntry: {
        id: module.id,
        version: module.version,
        source: `registry:${module.id}@${module.version}`,
        sourceRef: module.sourceRef,
        checksum: `sha256:preview-${module.id}-${module.version}`,
        mode: requestedMode,
        ...requestedMode === "service" ? { worker: serviceWorker, d1: serviceD1Binding } : {}
      },
      filesLikelyTouched,
      nextSteps: [
        "Review the plan with the user.",
        "Request approval for gated side effects.",
        requestedMode === "service" ? "Provision the per-service D1 and service bindings after approval." : "Apply a branch or patch after approval.",
        "Run checks before preview deployment."
      ]
    };
  });
}
function planDeploymentResources(input = {}) {
  return capture(() => {
    const options = typeof input === "string" ? { templateId: input } : input;
    const composition = composeApp({
      templateId: options.templateId,
      modules: options.modules,
      config: options.config
    });
    const mode = options.mode ?? composition.lock?.deploy?.mode ?? "embedded";
    if (mode !== "embedded" && mode !== "service") {
      const error = new Error(`Unknown deploy mode: ${mode}.`);
      error.code = "INVALID_DEPLOY_MODE";
      error.remediation = "Use mode embedded (default) or service.";
      throw error;
    }
    const uniq = (values) => [...new Set(values)];
    const slug = slugify(composition.config.appSlug ?? composition.config.appName ?? composition.template.id);
    const project = options.project ?? "<project>";
    const env = options.env ?? "<env>";
    const classify = (binding) => binding === "DB" ? "d1" : binding.endsWith("_KV") ? "kv" : "other";
    const modules = composition.modules;
    if (mode === "embedded") {
      const kvBindings = uniq(modules.flatMap((module) => module.runtime.bindings).filter((b) => classify(b) === "kv"));
      return {
        mode,
        workers: [{ name: slug, modules: modules.map((m) => m.id), d1: ["DB"], kv: kvBindings }],
        resources: {
          d1: [{ binding: "DB", databaseName: `${slug}_db`, scope: "shared", modules: modules.map((m) => m.id) }],
          kv: kvBindings.map((binding) => ({ binding, namespaceName: `${slug}_${binding.toLowerCase()}`, scope: "shared" }))
        }
      };
    }
    const workers = modules.map((module) => {
      const d1Binding = `${module.id.replace(/-/g, "_").toUpperCase()}_DB`;
      const hasD1 = module.runtime.bindings.includes("DB") || (module.storage ?? []).includes("d1");
      const kv = module.runtime.bindings.filter((b) => classify(b) === "kv");
      return {
        name: `app_${project}_${module.id}_${env}`,
        module: module.id,
        d1: hasD1 ? [d1Binding] : [],
        kv,
        serviceBindings: (module.requires ?? []).map((dep) => ({ binding: dep.toUpperCase().replace(/-/g, "_"), worker: `app_${project}_${dep}_${env}` }))
      };
    });
    return {
      mode,
      workers,
      resources: {
        d1: workers.flatMap(
          (worker) => worker.d1.map((binding) => ({ binding, databaseName: `${slug}_${worker.module}_db`, scope: "service", service: worker.module }))
        ),
        kv: workers.flatMap(
          (worker) => worker.kv.map((binding) => ({ binding, namespaceName: `${slug}_${worker.module}_${binding.toLowerCase()}`, scope: "service", service: worker.module }))
        )
      }
    };
  });
}
function getSecretsStatus(input = {}) {
  return capture(() => {
    const ids = new Set(lockedModuleIds(input));
    const modules = moduleCatalog().modules.filter((module) => ids.has(module.id) || module.secrets.length > 0);
    return {
      secrets: modules.flatMap(
        (module) => module.secrets.map((name) => ({
          module: module.id,
          name,
          configured: false,
          scope: `project/env/module/${module.id}/${name}`,
          valueVisibleToAgent: false
        }))
      )
    };
  });
}
function checkUpdates(input = {}) {
  return capture(() => {
    const lock = moduleLock(input);
    const modulesById = /* @__PURE__ */ new Map();
    for (const module of moduleCatalog().modules) {
      if (!modulesById.has(module.id)) modulesById.set(module.id, []);
      modulesById.get(module.id).push(module);
    }
    const current = [];
    const unavailable = [];
    for (const locked of lock.modules ?? []) {
      const candidates = modulesById.get(locked.id) ?? [];
      if (!candidates.length) {
        unavailable.push({ id: locked.id, currentVersion: locked.version, reason: "No matching catalog module." });
        continue;
      }
      const module = candidates[0];
      const direction = versionDirection(locked.version, module.version);
      current.push({
        id: locked.id,
        currentVersion: locked.version,
        latestVersion: module.version,
        availableVersions: uniqueValues(candidates.map((candidate) => candidate.version)),
        direction,
        status: direction === "none" ? "current" : "update-available"
      });
    }
    return {
      schemaVersion: lock.schemaVersion ?? null,
      registryVersion: moduleCatalog().schemaVersion,
      template: lock.template ?? null,
      current,
      available: current.filter((item) => item.status === "update-available"),
      unavailable,
      policy: lock.customizations ?? {
        config: true,
        hooks: [],
        overlays: [],
        forks: []
      }
    };
  });
}
function planModuleUpgrade(input = {}) {
  return capture(() => {
    const options = typeof input === "string" ? { moduleId: input } : input;
    const request = moduleRequest(options, ["targetVersion", "to", "version"]);
    if (!request.id) {
      const error = new Error("Missing module id.");
      error.code = "MODULE_ID_REQUIRED";
      error.remediation = "Pass a module id such as booking.";
      throw error;
    }
    const lock = moduleLock(options);
    const locked = (lock.modules ?? []).find((module2) => module2.id === request.id);
    if (!locked) {
      const error = new Error(`Module is not installed: ${request.id}`);
      error.code = "MODULE_NOT_INSTALLED";
      error.remediation = "Run microservices modules list --json, then plan an upgrade for an installed module.";
      error.details = { moduleId: request.id };
      throw error;
    }
    const module = findCatalogModule(request.id, request.version);
    const hasSnapshot = Boolean(locked.contract && typeof locked.contract === "object");
    const currentContract = locked.contract ?? {};
    const nextContract = targetContract(module);
    const direction = versionDirection(locked.version, module.version);
    const versionChangeAvailable = direction !== "none";
    const diff = {
      mount: hasSnapshot && currentContract.mount !== nextContract.mount ? { from: currentContract.mount ?? null, to: nextContract.mount } : { from: currentContract.mount ?? nextContract.mount, to: nextContract.mount },
      resources: stringDiff(currentContract.resources, nextContract.resources, hasSnapshot),
      permissions: stringDiff(currentContract.permissions, nextContract.permissions, hasSnapshot),
      hooks: stringDiff(currentContract.hooks, nextContract.hooks, hasSnapshot),
      events: stringDiff(currentContract.events, nextContract.events, hasSnapshot),
      requires: stringDiff(currentContract.requires, nextContract.requires, hasSnapshot),
      secrets: {
        added: versionChangeAvailable ? nextContract.secrets : [],
        removed: [],
        unchanged: versionChangeAvailable ? [] : nextContract.secrets,
        snapshotAvailable: false
      }
    };
    const customizations = lock.customizations ?? {};
    const customizationImpact = {
      configPreserved: customizations.config !== false,
      hooksToReview: module.hooks,
      overlaysToReview: matchingCustomizations(customizations.overlays, module.id),
      forksToReview: matchingCustomizations(customizations.forks, module.id)
    };
    const hasForks = customizationImpact.forksToReview.length > 0;
    const hasOverlays = customizationImpact.overlaysToReview.length > 0;
    const changesResources = diff.resources.added.length > 0 || diff.resources.removed.length > 0;
    const changesPermissions = diff.permissions.added.length > 0 || diff.permissions.removed.length > 0;
    const changesSecrets = diff.secrets.added.length > 0 || diff.secrets.removed.length > 0;
    const approvalRequired = versionChangeAvailable && (module.approvalRisk === "high" || changesSecrets || changesResources || changesPermissions || hasForks || hasOverlays);
    const risk = !versionChangeAvailable ? "low" : approvalRequired || hasForks ? "high" : hasOverlays || diff.hooks.added.length || diff.hooks.removed.length ? "medium" : "low";
    return {
      module: {
        id: module.id,
        name: module.name,
        status: module.status,
        currentVersion: locked.version,
        targetVersion: module.version,
        requestedVersion: request.version ?? module.version,
        availableVersions: catalogVersions(module.id)
      },
      action: direction === "none" ? "no-op" : `${direction}-plan`,
      direction,
      upgradeAvailable: versionChangeAvailable,
      versionChangeAvailable,
      approvalRequired,
      risk,
      lockfile: {
        schemaVersion: lock.schemaVersion ?? null,
        registryVersion: moduleCatalog().schemaVersion,
        template: lock.template ?? null,
        source: locked.source ?? null,
        checksum: locked.checksum ?? null,
        sourceRef: locked.sourceRef ?? null,
        targetSourceRef: module.sourceRef ?? null,
        contractSnapshotAvailable: hasSnapshot
      },
      diff,
      customizationImpact,
      filesLikelyTouched: versionChangeAvailable ? filesForUpgrade(module, diff) : [],
      permissionGate: {
        required: approvalRequired,
        reasons: [
          module.approvalRisk === "high" ? "high-risk module" : null,
          changesSecrets ? "secret changes" : null,
          changesResources ? "resource changes" : null,
          changesPermissions ? "permission changes" : null,
          hasOverlays ? "overlay customizations require merge review" : null,
          hasForks ? "forked module requires manual merge review" : null
        ].filter(Boolean)
      },
      nextSteps: versionChangeAvailable ? [
        "Review this plan with the user before modifying source.",
        `Create a branch or patch for the ${direction}.`,
        "Review hook, overlay, and fork impacts before applying generated changes.",
        "Run pnpm microservices check --json and pnpm typecheck after applying.",
        "Deploy preview only after approval for resources, migrations, webhooks, or secrets."
      ] : [
        "The installed module already matches the requested registry version.",
        "Run microservices updates --json later to check again."
      ]
    };
  });
}
function validateConfig(input = {}) {
  return capture(() => {
    const composition = composeApp(input);
    const warnings = [];
    if (composition.config.timezone === "UTC") {
      warnings.push("Timezone is still UTC. Set a business timezone before customer testing.");
    }
    if (composition.config.appName === "Booking Business") {
      warnings.push("App name is still the template default. Customize it for demos.");
    }
    return {
      valid: true,
      warnings,
      requiredBindings: composition.bindings,
      requiredStorage: composition.storage,
      customizationMode: composition.upgradePolicy.compatibleCustomization
    };
  });
}
function generateProject(input = {}) {
  return capture(() => {
    const composition = composeApp(input);
    return {
      composition,
      files: buildProjectFiles(composition),
      nextSteps: [
        "Write files to a target directory.",
        "Run pnpm install in the generated project.",
        "Run pnpm db:init to initialize local D1.",
        "Run pnpm dev to start the generated Worker."
      ]
    };
  });
}
function runChecks(input = {}) {
  return capture(() => {
    const composition = composeApp(input);
    const checks = [
      {
        id: "module-contract",
        status: "pass",
        message: `${composition.modules.length} modules resolved with explicit contracts.`
      },
      {
        id: "dependency-resolution",
        status: "pass",
        message: `Resolved order: ${composition.modules.map((module) => module.id).join(" -> ")}.`
      },
      {
        id: "worker-bindings",
        status: "pass",
        message: `Required bindings: ${composition.bindings.join(", ")}.`
      },
      {
        id: "hook-surface",
        status: "pass",
        message: `${composition.hooks.length} typed customization hooks exposed.`
      },
      {
        id: "preview-control-plane",
        status: "pass",
        message: "Preview deployment records and generated artifacts are supported by the API control plane."
      },
      {
        id: "managed-cloudflare-provisioning",
        status: "pending",
        message: "Guarded D1/KV provisioning is wired; Worker upload and route activation remain pending."
      }
    ];
    return {
      status: checks.every((check) => check.status === "pass") ? "pass" : "pending",
      checks
    };
  });
}

// src/server.js
var SERVER_NAME = "microservices.sh";
var SERVER_VERSION = "0.1.3";
var PROTOCOL_VERSION = "2025-06-18";
var DEFAULT_API_URL = "https://api.microservices.sh";
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
      details
    }
  };
}
function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`Missing required parameter: ${name}`), {
      code: "INVALID_PARAMS",
      details: { parameter: name }
    });
  }
  return value.trim();
}
function objectParams(params) {
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}
function templateInput(args) {
  return {
    templateId: typeof args.templateId === "string" ? args.templateId : void 0,
    modules: Array.isArray(args.modules) ? args.modules : void 0,
    config: args.config && typeof args.config === "object" && !Array.isArray(args.config) ? args.config : void 0
  };
}
function apiConfig(env, args = {}) {
  return {
    apiUrl: String(args.apiUrl ?? env.MICROSERVICES_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, ""),
    apiKey: args.apiKey ?? env.MICROSERVICES_API_KEY ?? env.MICROSERVICES_TOKEN ?? null
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
      body: body ? JSON.stringify(body) : void 0
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
    warnings: payload?.warnings ?? []
  };
}
function jsonSchema(properties = {}, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}
var TEMPLATE_INPUT_SCHEMA = {
  templateId: {
    type: "string",
    description: "Template id to use for app composition. Omit to use the registry default template."
  },
  modules: {
    type: "array",
    items: { type: "string" },
    description: "Optional microservices.sh module ids to include, such as auth, booking, customer, payment, files, or audit-log."
  },
  config: {
    type: "object",
    additionalProperties: true,
    description: "Template configuration overrides for generated source, runtime bindings, or module-specific settings."
  }
};
var TOOLS = [
  {
    name: "list_templates",
    title: "List Templates",
    description: "List available microservices.sh app templates, including template ids and summaries. Use this before inspect_template, compose_app, generate_project, or run_checks when choosing a foundation for a new Cloudflare app.",
    inputSchema: jsonSchema()
  },
  {
    name: "inspect_template",
    title: "Inspect Template",
    description: "Inspect one app template contract, including supported modules, default configuration, runtime metadata, and generation behavior. Use this before composing or generating a project from a specific template id.",
    inputSchema: jsonSchema(
      {
        templateId: { type: "string", description: "Template id returned by list_templates, for example booking-sveltekit." }
      },
      ["templateId"]
    )
  },
  {
    name: "list_modules",
    title: "List Modules",
    description: "List available verified microservices.sh modules with ids, categories, summaries, versions, and maturity status. Use this to discover production building blocks before inspect_module, compose_app, or plan_add_module.",
    inputSchema: jsonSchema()
  },
  {
    name: "inspect_module",
    title: "Inspect Module",
    description: "Inspect one module contract in detail, including permissions, hooks, events, resources, storage needs, and customization points. Use this before editing or adding a module so the agent understands the module boundaries.",
    inputSchema: jsonSchema(
      {
        moduleId: { type: "string", description: "Module id returned by list_modules, for example auth, booking, customer, payment, files, or audit-log." }
      },
      ["moduleId"]
    )
  },
  {
    name: "list_module_docs",
    title: "List Module Docs",
    description: "List LLM-readable documentation pages available for module implementation guidance. Use this to discover local docs before get_module_doc or before changing generated source.",
    inputSchema: jsonSchema()
  },
  {
    name: "get_module_doc",
    title: "Get Module Doc",
    description: "Return an LLM-readable documentation page for a module, including rules, implementation notes, and agent guidance. Use this before coding against a module contract.",
    inputSchema: jsonSchema(
      {
        moduleId: { type: "string", description: "Module id whose documentation should be returned, for example booking or payment." }
      },
      ["moduleId"]
    )
  },
  {
    name: "compose_app",
    title: "Compose App",
    description: "Compose a template and selected modules into a checked app contract and lockfile plan without writing files. Use this to preview the exact app composition before generate_project or deployment planning.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA)
  },
  {
    name: "validate_config",
    title: "Validate Config",
    description: "Validate a template, module list, and configuration object before generation or deployment. Use this to catch unsupported modules, missing settings, and invalid config before side effects.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA)
  },
  {
    name: "generate_project",
    title: "Generate Project",
    description: "Generate project source files in memory for agent inspection. This tool does not write files; use it to review planned source, docs, migrations, and config before creating or editing a local project.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA)
  },
  {
    name: "run_checks",
    title: "Run Checks",
    description: "Run local contract and readiness checks for a template/module composition. Use this before deployment planning to verify module compatibility, generated artifacts, and operational guardrails.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA)
  },
  {
    name: "plan_add_module",
    title: "Plan Add Module",
    description: "Plan an approval-gated module addition against an optional existing microservices.lock.json. This tool reports intended lockfile changes and required review gates without writing files.",
    inputSchema: jsonSchema({
      moduleId: { type: "string", description: "Module id or module@version selector to add, for example payment or booking@0.1.0." },
      version: { type: "string", description: "Optional explicit target version when moduleId does not include @version." },
      lock: { type: "object", additionalProperties: true, description: "Optional existing microservices.lock.json content used to calculate a safe add plan." }
    })
  },
  {
    name: "check_updates",
    title: "Check Updates",
    description: "Check locked module versions against the bundled registry snapshot. Use this to identify available module updates before plan_module_upgrade.",
    inputSchema: jsonSchema({
      lock: { type: "object", additionalProperties: true, description: "Optional existing microservices.lock.json content to compare against known module versions." }
    })
  },
  {
    name: "plan_module_upgrade",
    title: "Plan Module Upgrade",
    description: "Plan a module version change and report approval gates, compatibility notes, and lockfile impact. Use this before applying a module upgrade.",
    inputSchema: jsonSchema({
      moduleId: { type: "string", description: "Module id or module@version selector to upgrade, for example auth or payment@0.1.0." },
      version: { type: "string", description: "Optional current version when it is not available from the lockfile." },
      to: { type: "string", description: "Optional target version. Omit to let the planner choose the latest known version." },
      lock: { type: "object", additionalProperties: true, description: "Optional existing microservices.lock.json content used to calculate upgrade impact." }
    })
  },
  {
    name: "get_secrets_status",
    title: "Get Secrets Status",
    description: "Report required secret names and configured/missing status for a template/module composition without exposing secret values. Use this before deployment planning or remote preview deploys.",
    inputSchema: jsonSchema(TEMPLATE_INPUT_SCHEMA)
  },
  {
    name: "create_preview_plan",
    title: "Create Preview Plan",
    description: "Create a local preview-deployment readiness plan without mutating remote state. Use this before deploy_preview to review resources, checks, errors, warnings, and required approval steps.",
    inputSchema: jsonSchema({
      ...TEMPLATE_INPUT_SCHEMA,
      mode: { type: "string", enum: ["embedded", "service"], description: "Deployment topology mode: embedded for one Worker app, service for separated service modules." }
    })
  },
  {
    name: "deploy_preview",
    title: "Deploy Preview",
    description: "Prepare a remote preview deployment through the microservices.sh control plane. This is a mutating tool and requires confirm: preview; call create_preview_plan first and only proceed after human review.",
    inputSchema: jsonSchema(
      {
        ...TEMPLATE_INPUT_SCHEMA,
        name: { type: "string", description: "Project or deployment display name recorded in the preview deployment request." },
        actor: { type: "string", description: "Actor label for audit logs, such as the agent, user, or workflow initiating the preview." },
        apiUrl: { type: "string", description: "Optional control-plane URL. Defaults to MICROSERVICES_API_URL or https://api.microservices.sh." },
        apiKey: { type: "string", description: "Optional API key for the control plane. Prefer MICROSERVICES_API_KEY or MICROSERVICES_TOKEN in the environment." },
        confirm: { type: "string", enum: ["preview"], description: "Required literal confirmation for this mutating preview-deployment tool." }
      },
      ["confirm"]
    )
  },
  {
    name: "get_deployment_status",
    title: "Get Deployment Status",
    description: "Read a remote preview deployment status from the microservices.sh control plane. Use this after deploy_preview to poll status, inspect errors, or retrieve deployment metadata.",
    inputSchema: jsonSchema(
      {
        deploymentId: { type: "string", description: "Deployment id returned by deploy_preview or the microservices.sh control plane." },
        apiUrl: { type: "string", description: "Optional control-plane URL. Defaults to MICROSERVICES_API_URL or https://api.microservices.sh." },
        apiKey: { type: "string", description: "Optional API key for the control plane. Prefer MICROSERVICES_API_KEY or MICROSERVICES_TOKEN in the environment." }
      },
      ["deploymentId"]
    )
  }
];
var TOOL_HANDLERS = {
  list_templates: () => listTemplates2(),
  inspect_template: (args) => inspectTemplate2(requiredString(args.templateId, "templateId")),
  list_modules: () => listModules2(),
  inspect_module: (args) => inspectModule2(requiredString(args.moduleId, "moduleId")),
  list_module_docs: () => listModuleDocs(),
  get_module_doc: (args) => getModuleDoc(requiredString(args.moduleId, "moduleId")),
  compose_app: (args) => composeApp2(templateInput(args)),
  validate_config: (args) => validateConfig(templateInput(args)),
  generate_project: (args) => generateProject(templateInput(args)),
  run_checks: (args) => runChecks(templateInput(args)),
  plan_add_module: (args) => planAddModule(args),
  check_updates: (args) => checkUpdates(args),
  plan_module_upgrade: (args) => planModuleUpgrade(args),
  get_secrets_status: (args) => getSecretsStatus(templateInput(args)),
  create_preview_plan: (args) => {
    const input = { ...templateInput(args), mode: args.mode };
    const composition = composeApp2(input);
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
          'Use confirm: "preview" for the deploy_preview tool call.'
        ]
      },
      warnings: [composition, checks, resources].filter((item) => item.ok).flatMap((item) => item.warnings ?? [])
    };
  },
  deploy_preview: async (args, context) => {
    if (args.confirm !== "preview") {
      return sdkFail(
        "CONFIRMATION_REQUIRED",
        'deploy_preview is a mutating tool and requires confirm: "preview".',
        'Call create_preview_plan first, review the plan, then call deploy_preview with confirm: "preview".',
        { requiredConfirm: "preview" }
      );
    }
    return apiRequest(context.env, args, "/deployments/preview", {
      ...templateInput(args),
      name: typeof args.name === "string" ? args.name : void 0,
      actor: typeof args.actor === "string" ? args.actor : "mcp"
    });
  },
  get_deployment_status: (args, context) => apiRequest(context.env, args, `/deployments/${encodeURIComponent(requiredString(args.deploymentId, "deploymentId"))}`)
};
function toolResult(response) {
  const isError = response?.ok === false;
  return {
    content: [{ type: "text", text: text(response) }],
    structuredContent: response,
    isError
  };
}
async function callTool(name, args = {}, context = { env: process.env }) {
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
function rpcError(id, code, message, data = void 0) {
  return {
    jsonrpc: "2.0",
    id,
    error: data === void 0 ? { code, message } : { code, message, data }
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
        tools: {}
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION
      }
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
async function handleJsonRpcMessage(message, context = { env: process.env }) {
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
      error.details ?? void 0
    );
  }
}
function writeMessage(stdout, message) {
  if (!message) return;
  stdout.write(`${JSON.stringify(message)}
`);
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
async function startStdioServer({ stdin, stdout, stderr, env }) {
  const context = { stdin, stdout, stderr, env };
  const reader = createInterface({ input: stdin, crlfDelay: Infinity });
  stderr.write(`[microservices-mcp] stdio server started (${SERVER_VERSION})
`);
  for await (const line of reader) {
    await handleLine(line, context);
  }
}

// src/index.js
var VERSION = "0.1.3";
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
  process.stdout.write(`${VERSION}
`);
} else {
  startStdioServer({
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env
  }).catch((error) => {
    process.stderr.write(`[microservices-mcp] fatal: ${error.stack ?? error.message}
`);
    process.exitCode = 1;
  });
}
