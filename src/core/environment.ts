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

/**
 * Resolve facilitator URL from a conflict-free options union.
 * Throws if both `environment` and `facilitatorUrl` are set, or neither.
 */
export function resolveFacilitatorUrl(options: TransX402Options): {
  facilitatorUrl: string;
  configSection: ApiKeyFamily;
  environment: TransX402Environment | null;
} {
  const hasEnvironment = options.environment != null;
  const hasFacilitatorUrl =
    typeof options.facilitatorUrl === "string" &&
    options.facilitatorUrl.length > 0;

  if (hasEnvironment && hasFacilitatorUrl) {
    throw new Error(
      "Set either `environment` or `facilitatorUrl`, not both. " +
        "Chain params always come from GET /config."
    );
  }

  if (!hasEnvironment && !hasFacilitatorUrl) {
    throw new Error(
      "Set `environment` (\"local\" | \"camp\" | \"base\") or `facilitatorUrl`. " +
        "No silent default — choose explicitly."
    );
  }

  if (hasEnvironment) {
    const environment = options.environment!;
    assertApiKeyMatchesEnvironment(options.apiKey, environment);
    return {
      facilitatorUrl: FACILITATOR_PRESETS[environment],
      configSection: environmentToConfigSection(environment),
      environment,
    };
  }

  // Advanced: custom facilitator — config section follows API key family
  const family = detectApiKeyFamily(options.apiKey);
  return {
    facilitatorUrl: options.facilitatorUrl!,
    configSection: family,
    environment: null,
  };
}
