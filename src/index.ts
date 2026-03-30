import type {
  IndoPay402Options,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
} from "./types.js";
import {
  connectWallet,
  checkConnection,
  WalletConnectionError,
  type WalletConnection,
} from "./wallet.js";
import {
  checkPermit2Approval,
  requestPermit2Approval,
  isAmountApproved,
  createPublicClientForChain,
  Permit2Error,
} from "./permit2.js";
import type { Address, Hex } from "viem";

export type {
  IndoPay402Options,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
} from "./types.js";
export { WalletConnectionError } from "./wallet.js";
export { Permit2Error } from "./permit2.js";

const FACILITATOR_URLS = {
  sandbox: "https://sandbox.indopay402.xyz",
  production: "https://api.indopay402.xyz",
} as const;

const IDRX_CONTRACT = "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22" as const;
const BASE_CHAIN_ID = 8453;

function detectEnvironment(apiKey: string): "sandbox" | "production" {
  if (apiKey.startsWith("ipk_sandbox_")) return "sandbox";
  if (apiKey.startsWith("ipk_live_")) return "production";
  throw new Error(
    `Invalid API key prefix. Expected ipk_sandbox_ or ipk_live_`
  );
}

/**
 * Convert IDR amount to IDRX base units (IDRX has 2 decimals)
 */
function toIDRXBaseUnits(idrAmount: string): string {
  // IDRX has 2 decimals, so multiply by 100
  return (BigInt(idrAmount) * 100n).toString();
}

/**
 * Generate a nonce for Permit2
 */
function generateNonce(): string {
  return BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000)).toString();
}

/**
 * Create deadline 1 hour from now
 */
function createDeadline(): string {
  return (Math.floor(Date.now() / 1000) + 3600).toString();
}

/**
 * Create SIWE message for signing
 */
function createPermitMessage(
  token: string,
  amount: string,
  to: string,
  nonce: string,
  deadline: string
): string {
  return JSON.stringify({
    token,
    amount,
    to,
    nonce,
    deadline,
  });
}

export class IndoPay402Client {
  private apiKey: string;
  private facilitatorUrl: string;
  private options: IndoPay402Options;
  private walletConnection: WalletConnection | null = null;
  private publicClient: ReturnType<typeof createPublicClientForChain> | null = null;

  constructor(options: IndoPay402Options) {
    this.options = options;
    this.apiKey = options.apiKey;

    const env = detectEnvironment(options.apiKey);
    this.facilitatorUrl =
      options.facilitatorUrl ?? FACILITATOR_URLS[env];

    // Initialize public client for the appropriate network
    const rpcUrl =
      env === "sandbox"
        ? "http://localhost:8545"
        : "https://mainnet.base.org";
    this.publicClient = createPublicClientForChain(rpcUrl);
  }

  /**
   * Connect or reconnect the wallet
   */
  async connectWallet(): Promise<string> {
    try {
      this.walletConnection = await connectWallet();
      const address = this.walletConnection.address;
      
      this.options.onWalletConnect?.(address);
      
      return address;
    } catch (err) {
      if (err instanceof WalletConnectionError) {
        this.options.onPaymentError?.(err);
      }
      throw err;
    }
  }

  /**
   * Check if wallet is connected and return address
   */
  async isWalletConnected(): Promise<string | null> {
    if (!this.walletConnection) {
      return null;
    }
    
    const address = await checkConnection(this.walletConnection.provider);
    if (!address) {
      this.walletConnection = null;
    }
    
    return address;
  }

  /**
   * Check Permit2 approval status for the connected wallet
   */
  async checkApproval(): Promise<{ approved: boolean; allowance: string }> {
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }

    const result = await checkPermit2Approval(
      this.publicClient,
      IDRX_CONTRACT,
      this.walletConnection.address
    );

    return {
      approved: result.approved,
      allowance: result.allowance.toString(),
    };
  }

  /**
   * Request Permit2 approval from the user
   */
  async requestApproval(): Promise<string> {
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }

    this.options.onApprovalRequired?.();

    try {
      const txHash = await requestPermit2Approval(
        this.walletConnection.provider,
        IDRX_CONTRACT
      );

      return txHash;
    } catch (err) {
      if (err instanceof Permit2Error) {
        this.options.onPaymentError?.(err);
      }
      throw err;
    }
  }

  /**
   * Execute a payment directly
   */
  async pay(requirements: {
    to: string;
    amount: string;
    currency: string;
    resource?: string;
  }): Promise<PaymentResult> {
    // Ensure wallet is connected
    let walletAddress = await this.isWalletConnected();
    if (!walletAddress) {
      walletAddress = await this.connectWallet();
    }

    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Failed to connect wallet");
    }

    // Convert amount to IDRX base units
    const tokenAmount = toIDRXBaseUnits(requirements.amount);

    // Check Permit2 approval
    const approved = await isAmountApproved(
      this.publicClient,
      IDRX_CONTRACT,
      this.walletConnection.address,
      BigInt(tokenAmount)
    );

    if (!approved) {
      this.options.onApprovalRequired?.();
      await this.requestApproval();
    }

    this.options.onPaymentStart?.({
      to: requirements.to,
      amount: requirements.amount,
      currency: requirements.currency,
      resource: requirements.resource,
    });

    // Generate permit data
    const nonce = generateNonce();
    const deadline = createDeadline();
    const message = createPermitMessage(
      IDRX_CONTRACT,
      tokenAmount,
      requirements.to,
      nonce,
      deadline
    );

    // Sign the permit message
    const signature = await this.walletConnection.provider.request({
      method: "personal_sign",
      params: [message, this.walletConnection.address],
    }) as Hex;

    // Submit to facilitator
    const facilitateRequest = {
      permit: {
        permitted: {
          token: IDRX_CONTRACT,
          amount: tokenAmount,
        },
        nonce,
        deadline,
      },
      transferDetails: {
        to: requirements.to,
        requestedAmount: tokenAmount,
      },
      owner: this.walletConnection.address,
      signature,
      resource: requirements.resource,
    };

    const response = await fetch(`${this.facilitatorUrl}/facilitate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(facilitateRequest),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Payment facilitation failed");
    }

    const result = await response.json();

    const paymentResult: PaymentResult = {
      txHash: result.txHash,
      from: result.from,
      to: result.to,
      token: result.token,
      amount: requirements.amount,
      network: "base",
    };

    this.options.onPaymentSuccess?.(paymentResult);

    return paymentResult;
  }

  /**
   * 402-aware fetch wrapper. Automatically handles payment if the server
   * returns HTTP 402 with payment requirements.
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, init);

    if (response.status !== 402) {
      return response;
    }

    // Parse payment requirements from 402 response
    const requirements = await this.parsePaymentRequirements(response);
    if (!requirements) {
      return response;
    }

    // Execute payment
    const result = await this.pay({
      to: requirements.to,
      amount: requirements.amount,
      currency: requirements.currency,
      resource: url,
    });

    // Retry the original request with payment proof
    // The server should recognize the payment and return the content
    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...init?.headers,
        "X-Payment-Hash": result.txHash,
      },
    };

    return fetch(url, retryInit);
  }

  private async parsePaymentRequirements(
    response: Response
  ): Promise<PaymentRequirements | null> {
    try {
      const body = await response.json();
      return body as PaymentRequirements;
    } catch {
      return null;
    }
  }
}

export const IndoPay402 = {
  create(options: IndoPay402Options): IndoPay402Client {
    return new IndoPay402Client(options);
  },
};

export { Paywall, createPaywall, type PaywallOptions } from "./paywall.js";
export default IndoPay402;
