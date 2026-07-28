import type {
    Network as X402Network,
    PaymentPayload as X402PaymentPayload,
    PaymentRequired as X402PaymentRequired,
    PaymentRequirements as X402PaymentRequirements,
} from "@x402/fetch";

export type {
    X402Network,
    X402PaymentPayload,
    X402PaymentRequired,
    X402PaymentRequirements
};

/** Named deployment targets. Chain params always come from GET /config. */
export type TransX402Environment = "local" | "camp" | "base";

export type SponsorshipMode = "eip2612" | "erc20ApprovalRelay" | "none";

/**
 * Who calls TransX402 `POST /facilitate`:
 * - `server` — client signs and retries with PAYMENT-SIGNATURE; merchant backend settles
 * - `direct` — client settles with facilitator (paywall / zero-backend)
 *
 * Defaults: `fetch()` → `server`; `pay()` / paywall → `direct`.
 */
export type SettlementMode = "server" | "direct";

export interface PaymentCallbacks {
  onPaymentStart?: (details: PaymentDetails) => void;
  onPaymentSuccess?: (result: PaymentResult) => void;
  onPaymentError?: (error: Error) => void;
  onWalletConnect?: (address: string) => void;
  onApprovalRequired?: () => void;
}

/**
 * Pick exactly one of `environment` or `facilitatorUrl`.
 * Never set both. Chain params are loaded only from the facilitator's `/config`.
 *
 * `apiKey` is omitted when `environment` is set and `settlement` is `"server"` (default).
 * Required for `settlement: "direct"`, `pay()`, paywall, and `facilitatorUrl` setups.
 */
export type TransX402Options =
  | (PaymentCallbacks & {
      environment: TransX402Environment;
      facilitatorUrl?: never;
      /** Default `"server"`. Browser/agent do not call `/facilitate`. */
      settlement?: "server";
      apiKey?: never;
    })
  | (PaymentCallbacks & {
      environment: TransX402Environment;
      facilitatorUrl?: never;
      settlement: "direct";
      apiKey: string;
    })
  | (PaymentCallbacks & {
      apiKey: string;
      /** Advanced: custom facilitator. Mutually exclusive with `environment`. */
      facilitatorUrl: string;
      environment?: never;
      /** Settlement mode for `fetch()`. Default: `"server"`. `pay()` always uses `"direct"`. */
      settlement?: SettlementMode;
    });

export interface PaymentDetails {
  to: string;
  amount: string;
  currency: string;
  resource?: string;
}

export interface PaymentResult {
  txHash: string;
  from: string;
  to: string;
  token: string;
  amount: string;
  network: string;
}

export interface PaymentRequirements {
  to: string;
  amount: string;
  currency: string;
  resource?: string;
}

export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  network: string;
  tokenAddress: `0x${string}`;
  /** ERC-20 decimals for IDRX (from GET /config). Used for MetaMask spending-cap display. */
  tokenDecimals: number;
  permit2Address: `0x${string}`;
  sponsorshipMode: SponsorshipMode;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}
