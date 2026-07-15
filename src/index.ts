import type {
  TransX402Options,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
  X402PaymentPayload,
  X402PaymentRequired,
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
  createPublicClientForChain,
  Permit2Error,
} from "./permit2.js";
import { createPaywall, type PaywallOptions } from "./paywall.js";
import {
  createWalletClient,
  custom,
  defineChain,
  type Address,
} from "viem";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";

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
    chainId: 1337,
    tokenAddress: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
    permit2Address: "0xbD9Ef36F3587D5e8b57b3F8a1AE3A327bD538fbA",
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
  private httpPaymentClient: x402HTTPClient | null = null;

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
      this.httpPaymentClient = null;

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
      this.httpPaymentClient = null;
      return null;
    }

    if (address.toLowerCase() !== this.walletConnection.address.toLowerCase()) {
      this.walletConnection = {
        ...this.walletConnection,
        address,
      };
      this.httpPaymentClient = null;
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

  private async getHttpPaymentClient(): Promise<x402HTTPClient> {
    await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }
    await this.ensureWalletChain();
    if (this.httpPaymentClient) return this.httpPaymentClient;

    const chain = defineChain({
      id: this.chainId,
      name: this.network,
      nativeCurrency: this.nativeCurrency,
      rpcUrls: { default: { http: [this.rpcUrl] } },
    });

    const walletClient = createWalletClient({
      chain,
      transport: custom(this.walletConnection.provider),
    });

    const signer = toClientEvmSigner(
      {
        address: this.walletConnection.address,
        signTypedData: (args) =>
          walletClient.signTypedData({
            ...args,
            account: this.walletConnection!.address,
          }),
        signTransaction: (args) =>
          walletClient.signTransaction({
            ...args,
            account: this.walletConnection!.address,
          }),
      },
      {
        readContract: (args) => this.publicClient!.readContract(args as never),
        getTransactionCount: ({ address }) =>
          this.publicClient!.getTransactionCount({ address }),
        estimateFeesPerGas: () => this.publicClient!.estimateFeesPerGas(),
      }
    );

    const paymentClient = new x402Client().register(
      `eip155:${this.chainId}`,
      new ExactEvmScheme(signer)
    );

    this.httpPaymentClient = new x402HTTPClient(paymentClient);
    return this.httpPaymentClient;
  }

  private async settleWithFacilitator(paymentPayload: X402PaymentPayload): Promise<{
    txHash: string | null;
    settlement?: Record<string, unknown>;
  }> {
    const response = await fetch(`${this.facilitatorUrl}/facilitate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements: paymentPayload.accepted,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: { message: "Payment facilitation failed" } }));
      throw new Error(error.error?.message || "Payment facilitation failed");
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

  private buildFallbackPaymentRequired(requirements: {
    to: string;
    amount: string;
    resource?: string;
  }): X402PaymentRequired {
    return {
      x402Version: 2,
      resource: { url: requirements.resource ?? "about:blank" },
      accepts: [
        {
          scheme: "exact",
          network: `eip155:${this.chainId}`,
          asset: this.tokenAddress,
          amount: toIDRXBaseUnits(requirements.amount),
          payTo: requirements.to,
          maxTimeoutSeconds: 60,
          extra: {
            assetTransferMethod: "permit2",
            name: "IDRX",
            version: "1",
          },
        },
      ],
      extensions: {
        ...declareEip2612GasSponsoringExtension(),
        ...declareErc20ApprovalGasSponsoringExtension(),
      },
    };
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

    this.options.onPaymentStart?.({
      to: requirements.to,
      amount: requirements.amount,
      currency: requirements.currency,
      resource: requirements.resource,
    });

    const paymentRequired = this.buildFallbackPaymentRequired({
      to: requirements.to,
      amount: requirements.amount,
      resource: requirements.resource,
    });
    const paymentClient = await this.getHttpPaymentClient();
    const paymentPayload = await paymentClient.createPaymentPayload(paymentRequired);
    const settlement = await this.settleWithFacilitator(paymentPayload);

    const paymentResult: PaymentResult = {
      txHash: settlement.txHash ?? "",
      from: this.walletConnection.address,
      to: requirements.to,
      token: "IDRX",
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

    const paymentRequired = await this.parseX402PaymentRequired(response, url);
    if (!paymentRequired) {
      return response;
    }

    const paymentClient = await this.getHttpPaymentClient();
    const paymentPayload = await paymentClient.createPaymentPayload(paymentRequired);
    await this.settleWithFacilitator(paymentPayload);

    const paymentSignature = encodePaymentSignatureHeader(paymentPayload);
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("PAYMENT-SIGNATURE", paymentSignature);
    retryHeaders.set("X-PAYMENT", paymentSignature);

    const retryInit: RequestInit = {
      ...init,
      headers: retryHeaders,
    };

    return fetch(url, retryInit);
  }

  private async parseX402PaymentRequired(
    response: Response,
    requestUrl: string
  ): Promise<X402PaymentRequired | null> {
    const paymentRequiredHeader =
      response.headers.get("PAYMENT-REQUIRED") ??
      response.headers.get("X-PAYMENT-REQUIRED");

    if (paymentRequiredHeader) {
      try {
        return decodePaymentRequiredHeader(paymentRequiredHeader);
      } catch {
        // fall through to body parsing
      }
    }

    try {
      const body = await response.json();
      if (body && typeof body === "object" && "accepts" in body) {
        return body as X402PaymentRequired;
      }

      const legacy = body as PaymentRequirements;
      if (legacy?.to && legacy?.amount) {
        return this.buildFallbackPaymentRequired({
          to: legacy.to,
          amount: legacy.amount,
          resource: legacy.resource ?? requestUrl,
        });
      }
      return null;
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
