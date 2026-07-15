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
  X402PaymentRequirements,
};

export interface TransX402Options {
  apiKey: string;
  /** Override facilitator URL (auto-detected from apiKey prefix) */
  facilitatorUrl?: string;
  /** Override RPC URL */
  rpcUrl?: string;
  /** Override EVM chain ID */
  chainId?: number;
  /** Override token contract address */
  tokenAddress?: string;
  /** Override Permit2 contract address */
  permit2Address?: string;
  /** Token symbol (default: IDRX) */
  token?: string;
  /** Network (default: base) */
  network?: string;
  /** Callbacks */
  onPaymentStart?: (details: PaymentDetails) => void;
  onPaymentSuccess?: (result: PaymentResult) => void;
  onPaymentError?: (error: Error) => void;
  onWalletConnect?: (address: string) => void;
  onApprovalRequired?: () => void;
}

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
