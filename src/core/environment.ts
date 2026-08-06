import type { TransX402Environment, TransX402Options } from "../types.js";

export const FACILITATOR_PRESETS = {
  local: "http://localhost:3402",
  camp: "https://api.transx402.com",
  base: "https://api.transx402.com",
} as const satisfies Record<TransX402Environment, string>;

/** Default same-origin config proxy base (client appends `/config`). */
export const DEFAULT_CONFIG_PROXY_PATH = "/api/transx402";

export type ApiKeyFamily = "sandbox" | "production";
export type ApiKeyType = "secret" | "publishable";

export function detectKeyType(apiKey: string): ApiKeyType {
  if (apiKey.startsWith("ipk_pub_")) return "publishable";
  return "secret";
}

export function detectApiKeyFamily(apiKey: string): ApiKeyFamily {
  if (apiKey.startsWith("ipk_pub_sandbox_") || apiKey.startsWith("ipk_sandbox_")) {
    return "sandbox";
  }
  if (apiKey.startsWith("ipk_pub_live_") || apiKey.startsWith("ipk_live_")) {
    return "production";
  }
  throw new Error(
    `Invalid API key prefix. Expected ipk_sandbox_, ipk_live_, ipk_pub_sandbox_, or ipk_pub_live_`
  );
}

export function environmentToConfigSection(
  environment: TransX402Environment
): ApiKeyFamily {
  return environment === "base" ? "production" : "sandbox";
}

export function assertApiKeyMatchesEnvironment(
  apiKey: string,
  environment: TransX402Environment
): void {
  const family = detectApiKeyFamily(apiKey);
  const expected = environmentToConfigSection(environment);
  if (family !== expected) {
    throw new Error(
      `API key family "${family}" does not match environment "${environment}". ` +
        `Use ipk_${expected === "sandbox" ? "sandbox" : "live"}_... for ${environment}.`
    );
  }
}

export function requireApiKeyForDirectSettlement(
  apiKey: string | undefined,
  context: string
): string {
  if (!apiKey?.trim()) {
    throw new Error(
      `\`apiKey\` is required for ${context}. ` +
        `Omit \`apiKey\` only when \`environment\` is set and \`settlement\` is \`"server"\` (default).`
    );
  }
  return apiKey;
}

function readOptionalApiKey(options: TransX402Options): string | undefined {
  return "apiKey" in options ? options.apiKey : undefined;
}

function readConfigProxyPath(options: TransX402Options): string | undefined {
  return "configProxyPath" in options
    ? options.configProxyPath?.trim()
    : undefined;
}

function normalizeConfigProxyPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    throw new Error(
      `configProxyPath must start with "/" (received "${path}")`
    );
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveFacilitatorHost(
  options: TransX402Options,
  environment: TransX402Environment
): string {
  const facilitatorOverride = options.facilitatorUrl?.trim();
  const configProxyPath = readConfigProxyPath(options);

  if (facilitatorOverride && configProxyPath) {
    throw new Error(
      "Set either `facilitatorUrl` or `configProxyPath`, not both."
    );
  }

  if (configProxyPath) {
    const settlement = "settlement" in options ? options.settlement : "server";
    if (settlement === "direct") {
      throw new Error(
        "`configProxyPath` is only supported for server settlement (default `fetch()` mode)."
      );
    }
    return normalizeConfigProxyPath(configProxyPath);
  }

  return facilitatorOverride || FACILITATOR_PRESETS[environment];
}

/**
 * Resolve facilitator URL and config section from options.
 * Requires `environment` and/or `facilitatorUrl` (with `apiKey` when environment is omitted).
 */
export function resolveFacilitatorUrl(options: TransX402Options): {
  facilitatorUrl: string;
  configSection: ApiKeyFamily;
  environment: TransX402Environment | null;
} {
  const hasEnvironment = options.environment != null;
  const facilitatorOverride = options.facilitatorUrl?.trim();
  const hasFacilitatorOverride = Boolean(facilitatorOverride);

  if (!hasEnvironment && !hasFacilitatorOverride) {
    throw new Error(
      "Set `environment` (\"local\" | \"camp\" | \"base\") or `facilitatorUrl`. " +
        "No silent default — choose explicitly."
    );
  }

  if (hasEnvironment) {
    const environment = options.environment!;
    const apiKey = readOptionalApiKey(options);
    if (apiKey != null) {
      assertApiKeyMatchesEnvironment(apiKey, environment);
    }
    return {
      facilitatorUrl: resolveFacilitatorHost(options, environment),
      configSection: environmentToConfigSection(environment),
      environment,
    };
  }

  // Advanced: custom facilitator without environment — config section follows API key family
  const apiKey = readOptionalApiKey(options);
  if (!apiKey) {
    throw new Error(
      "`apiKey` is required when using `facilitatorUrl` without `environment`."
    );
  }
  const family = detectApiKeyFamily(apiKey);
  return {
    facilitatorUrl: facilitatorOverride!,
    configSection: family,
    environment: null,
  };
}
