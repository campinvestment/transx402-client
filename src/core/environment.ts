import type { TransX402Environment, TransX402Options } from "../types.js";

export const FACILITATOR_PRESETS = {
  local: "http://localhost:3402",
  camp: "https://api.transx402.com",
  base: "https://api.transx402.com",
} as const satisfies Record<TransX402Environment, string>;

export type ApiKeyFamily = "sandbox" | "production";

export function detectApiKeyFamily(apiKey: string): ApiKeyFamily {
  if (apiKey.startsWith("ipk_sandbox_")) return "sandbox";
  if (apiKey.startsWith("ipk_live_")) return "production";
  throw new Error(
    `Invalid API key prefix. Expected ipk_sandbox_ or ipk_live_`
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
      facilitatorUrl:
        facilitatorOverride || FACILITATOR_PRESETS[environment],
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
