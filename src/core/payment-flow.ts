import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import type {
  SponsorshipMode,
  X402PaymentPayload,
  X402PaymentRequired,
} from "../types.js";
import type { Address } from "viem";

/** Convert IDR amount to IDRX base units (IDRX has 2 decimals). */
export function toIDRXBaseUnits(idrAmount: string): string {
  return (BigInt(idrAmount) * 100n).toString();
}

export function buildPaymentExtensions(options: {
  sponsorshipMode: SponsorshipMode;
  /** Path 3 only: declare erc20ApprovalGasSponsoring when allowance insufficient. */
  declareErc20ApprovalRelay: boolean;
}): Record<string, unknown> {
  if (options.sponsorshipMode === "eip2612") {
    return { ...declareEip2612GasSponsoringExtension() };
  }

  if (
    options.sponsorshipMode === "erc20ApprovalRelay" &&
    options.declareErc20ApprovalRelay
  ) {
    return { ...declareErc20ApprovalGasSponsoringExtension() };
  }

  return {};
}

export function buildFallbackPaymentRequired(options: {
  to: string;
  amount: string;
  resource?: string;
  chainId: number;
  tokenAddress: Address;
  extensions: Record<string, unknown>;
}): X402PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: options.resource ?? "about:blank" },
    accepts: [
      {
        scheme: "exact",
        network: `eip155:${options.chainId}`,
        asset: options.tokenAddress,
        amount: toIDRXBaseUnits(options.amount),
        payTo: options.to,
        maxTimeoutSeconds: 60,
        extra: {
          assetTransferMethod: "permit2",
          name: "IDRX",
          version: "1",
        },
      },
    ],
    extensions: options.extensions,
  };
}

export async function settleWithFacilitator(options: {
  facilitatorUrl: string;
  apiKey: string;
  paymentPayload: X402PaymentPayload;
}): Promise<{
  txHash: string | null;
  settlement?: Record<string, unknown>;
}> {
  const response = await fetch(`${options.facilitatorUrl}/facilitate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": options.apiKey,
    },
    body: JSON.stringify({
      paymentPayload: options.paymentPayload,
      paymentRequirements: options.paymentPayload.accepted,
    }),
  });

  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ error: { message: "Payment facilitation failed" } }))) as {
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, string>;
      };
    };
    const details = error.error?.details;
    const detailText =
      details && Object.keys(details).length > 0
        ? ` (${Object.entries(details)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ")})`
        : "";
    throw new Error(
      (error.error?.message || "Payment facilitation failed") + detailText
    );
  }

  const result = (await response.json()) as {
    txHash?: string;
    settlement?: Record<string, unknown> & { transaction?: string };
  };

  return {
    txHash: result.txHash ?? result.settlement?.transaction ?? null,
    settlement: result.settlement,
  };
}

export function mapWalletSignerError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? (err as { code?: number | string }).code
      : undefined;

  if (
    code === -32004 ||
    code === "-32004" ||
    /method not supported/i.test(message)
  ) {
    return new Error(
      "Browser wallets cannot use sponsored approve (eth_signTransaction). " +
        "Complete on-chain Permit2 approval first, then pay with a signature only."
    );
  }

  return err instanceof Error ? err : new Error(message);
}
