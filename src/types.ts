export interface TransX402Options {
  apiKey: string;
  /** Override facilitator URL (auto-detected from apiKey prefix) */
  facilitatorUrl?: string;
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
