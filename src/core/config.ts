import type { Address } from "viem";
import type { NetworkConfig, SponsorshipMode } from "../types.js";
import type { WalletChainConfig } from "../wallet.js";
import type { ApiKeyFamily } from "./environment.js";

/** Canonical Permit2 — `@x402/evm` hardcodes this for allowance checks. */
export const CANONICAL_PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

interface FacilitatorEnvConfig {
  rpcUrl: string;
  chainId: number;
  network: string;
  tokens?: { IDRX?: string };
  tokenDecimals?: { IDRX?: number };
  permit2Address?: string;
  nativeCurrency?: WalletChainConfig["nativeCurrency"];
  x402?: {
    sponsorshipMode?: SponsorshipMode;
  };
}

/** IDRX is 2 decimals on all supported networks. */
export const IDRX_DECIMALS = 2;

interface FacilitatorConfigResponse {
  sandbox?: FacilitatorEnvConfig;
  production?: FacilitatorEnvConfig;
}

const FALLBACK_NATIVE = {
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
} as const;

/**
 * Load network config exclusively from the facilitator's GET /config.
 * No client-side rpc/chain/token overrides.
 */
export async function loadNetworkConfig(
  facilitatorUrl: string,
  configSection: ApiKeyFamily
): Promise<NetworkConfig> {
  const response = await fetch(`${facilitatorUrl}/config`);
  if (!response.ok) {
    throw new Error(
      `Failed to load facilitator config from ${facilitatorUrl}/config ` +
        `(HTTP ${response.status})`
    );
  }

  const config = (await response.json()) as FacilitatorConfigResponse;
  const envConfig = config[configSection];
  if (!envConfig) {
    throw new Error(
      `Facilitator config missing "${configSection}" section at ${facilitatorUrl}/config`
    );
  }

  const tokenAddress = envConfig.tokens?.IDRX;
  if (!tokenAddress) {
    throw new Error(
      `Facilitator config missing IDRX token address in "${configSection}"`
    );
  }

  const tokenDecimals = envConfig.tokenDecimals?.IDRX ?? IDRX_DECIMALS;
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new Error(
      `Facilitator config has invalid tokenDecimals.IDRX=${String(envConfig.tokenDecimals?.IDRX)}`
    );
  }

  return {
    rpcUrl: envConfig.rpcUrl,
    chainId: envConfig.chainId,
    network: envConfig.network,
    tokenAddress: tokenAddress as Address,
    tokenDecimals,
    permit2Address: (envConfig.permit2Address ??
      CANONICAL_PERMIT2_ADDRESS) as Address,
    sponsorshipMode: envConfig.x402?.sponsorshipMode ?? "erc20ApprovalRelay",
    nativeCurrency: envConfig.nativeCurrency ?? FALLBACK_NATIVE,
  };
}
