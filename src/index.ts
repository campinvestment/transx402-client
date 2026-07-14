import type {
  TransX402Options,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
} from "./types.js";
import {
  connectWallet,
  checkConnection,
  ensureChain,
  WalletConnectionError,
  type WalletConnection,
  type WalletChainConfig,
} from "./wallet.js";
import {
  checkPermit2Approval,
  requestPermit2Approval,
  isAmountApproved,
  createPublicClientForChain,
  Permit2Error,
} from "./permit2.js";
import { createPaywall, type PaywallOptions } from "./paywall.js";
import type { Address, Hex } from "viem";

export type {
  TransX402Options,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
} from "./types.js";
export { WalletConnectionError } from "./wallet.js";
export { Permit2Error } from "./permit2.js";

const FACILITATOR_URLS = {
  sandbox: "https://sandbox.transx402.com",
  production: "https://api.transx402.com",
} as const;

const DEFAULT_NETWORK_CONFIG = {
  sandbox: {
    rpcUrl: "http://localhost:8545",
    chainId: 8453,
    tokenAddress: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22",
    permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    network: "sandbox",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  production: {
    rpcUrl: "https://mainnet.base.org",
    chainId: 8453,
    tokenAddress: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22",
    permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    network: "base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
} as const;

interface FacilitatorConfigResponse {
  sandbox?: {
    rpcUrl: string;
    chainId: number;
    network: string;
    tokens?: { IDRX?: string };
    permit2Address?: string;
    nativeCurrency?: WalletChainConfig["nativeCurrency"];
  };
  production?: {
    rpcUrl: string;
    chainId: number;
    network: string;
    tokens?: { IDRX?: string };
    permit2Address?: string;
    nativeCurrency?: WalletChainConfig["nativeCurrency"];
  };
}

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

export class TransX402Client {
  private apiKey: string;
  private environment: "sandbox" | "production";
  private facilitatorUrl: string;
  private options: TransX402Options;
  private walletConnection: WalletConnection | null = null;
  private publicClient: ReturnType<typeof createPublicClientForChain> | null = null;
  private rpcUrl: string;
  private chainId: number;
  private tokenAddress: Address;
  private permit2Address: Address;
  private network: string;
  private nativeCurrency: WalletChainConfig["nativeCurrency"];
  private configReady: Promise<void>;

  constructor(options: TransX402Options) {
    this.options = options;
    this.apiKey = options.apiKey;

    const env = detectEnvironment(options.apiKey);
    this.environment = env;
    const defaults = DEFAULT_NETWORK_CONFIG[env];
    this.facilitatorUrl =
      options.facilitatorUrl ?? FACILITATOR_URLS[env];

    this.rpcUrl = options.rpcUrl ?? defaults.rpcUrl;
    this.chainId = options.chainId ?? defaults.chainId;
    this.tokenAddress = (options.tokenAddress ?? defaults.tokenAddress) as Address;
    this.permit2Address = (options.permit2Address ?? defaults.permit2Address) as Address;
    this.network = defaults.network;
    this.nativeCurrency = defaults.nativeCurrency;
    this.publicClient = createPublicClientForChain(this.rpcUrl, this.chainId);
    this.configReady = this.initializeConfig();
  }

  private async initializeConfig(): Promise<void> {
    const needRemoteConfig =
      !this.options.rpcUrl ||
      !this.options.chainId ||
      !this.options.tokenAddress ||
      !this.options.permit2Address;

    if (!needRemoteConfig) return;

    try {
      const response = await fetch(`${this.facilitatorUrl}/config`);
      if (!response.ok) return;

      const config = (await response.json()) as FacilitatorConfigResponse;
      const envConfig = config[this.environment];
      if (!envConfig) return;

      this.rpcUrl = this.options.rpcUrl ?? envConfig.rpcUrl ?? this.rpcUrl;
      this.chainId = this.options.chainId ?? envConfig.chainId ?? this.chainId;
      this.tokenAddress =
        (this.options.tokenAddress ?? envConfig.tokens?.IDRX ?? this.tokenAddress) as Address;
      this.permit2Address =
        (this.options.permit2Address ??
          envConfig.permit2Address ??
          this.permit2Address) as Address;
      this.network = envConfig.network ?? this.network;
      this.nativeCurrency = envConfig.nativeCurrency ?? this.nativeCurrency;

      this.publicClient = createPublicClientForChain(this.rpcUrl, this.chainId);
    } catch {
      // Keep defaults and explicit overrides for local/dev resilience.
    }
  }

  private async ensureConfigReady(): Promise<void> {
    await this.configReady;
  }

  private async ensureWalletChain(): Promise<void> {
    if (!this.walletConnection) return;

    await ensureChain(this.walletConnection.provider, {
      chainId: this.chainId,
      chainName: this.network,
      rpcUrl: this.rpcUrl,
      nativeCurrency: this.nativeCurrency,
    });
  }

  /**
   * Connect or reconnect the wallet
   */
  async connectWallet(): Promise<string> {
    try {
      await this.ensureConfigReady();
      this.walletConnection = await connectWallet();
      await this.ensureWalletChain();
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
    await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }
    await this.ensureWalletChain();

    const result = await checkPermit2Approval(
      this.publicClient,
      this.tokenAddress,
      this.walletConnection.address,
      this.permit2Address
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
    await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }
    await this.ensureWalletChain();

    this.options.onApprovalRequired?.();

    try {
      const txHash = await requestPermit2Approval(
        this.walletConnection.provider,
        this.tokenAddress,
        this.permit2Address,
        this.chainId,
        undefined,
        this.rpcUrl
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
    await this.ensureConfigReady();
    // Ensure wallet is connected
    let walletAddress = await this.isWalletConnected();
    if (!walletAddress) {
      walletAddress = await this.connectWallet();
    }

    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Failed to connect wallet");
    }
    await this.ensureWalletChain();

    // Convert amount to IDRX base units
    const tokenAmount = toIDRXBaseUnits(requirements.amount);

    // Check Permit2 approval
    const approved = await isAmountApproved(
      this.publicClient,
      this.tokenAddress,
      this.walletConnection.address,
      BigInt(tokenAmount),
      this.permit2Address
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
      this.tokenAddress,
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
          token: this.tokenAddress,
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
      network: this.network,
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

export const TransX402 = {
  create(options: TransX402Options): TransX402Client {
    return new TransX402Client(options);
  },
  paywall(options: PaywallOptions) {
    return createPaywall(options);
  },
};

export { Paywall, createPaywall, type PaywallOptions } from "./paywall.js";
export default TransX402;
