import type {
  PaymentResult,
  PaymentRequirements,
  TransX402Options,
  X402PaymentRequired,
  NetworkConfig,
} from "../types.js";
import {
  connectWallet,
  checkConnection,
  ensureChain,
  watchErc20Asset,
  WalletConnectionError,
  type WalletConnection,
  type WalletChainConfig,
} from "../wallet.js";
import {
  checkPermit2Approval,
  requestPermit2Approval,
  createPublicClientForChain,
  readErc20TokenMeta,
  Permit2Error,
  defaultPermit2ApprovalAmount,
} from "../permit2.js";
import {
  createWalletClient,
  custom,
  defineChain,
  type Address,
} from "viem";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { resolveFacilitatorUrl } from "../core/environment.js";
import { loadNetworkConfig } from "../core/config.js";
import {
  needsPermit2Allowance,
  needsPermit2AllowanceBaseUnits,
} from "../core/allowance.js";
import {
  buildFallbackPaymentRequired,
  buildPaymentExtensions,
  mapWalletSignerError,
  settleWithFacilitator,
} from "../core/payment-flow.js";

/**
 * Browser / MetaMask client — Path 4 (self-paid Permit2 approve).
 * Never wires `signTransaction` (MetaMask rejects eth_signTransaction).
 */
export class BrowserClient {
  private apiKey: string;
  private facilitatorUrl: string;
  private options: TransX402Options;
  private walletConnection: WalletConnection | null = null;
  private publicClient: ReturnType<typeof createPublicClientForChain> | null =
    null;
  private networkConfig: NetworkConfig | null = null;
  private configReady: Promise<void>;
  private httpPaymentClient: x402HTTPClient | null = null;
  private payInFlight = false;

  constructor(options: TransX402Options) {
    this.options = options;
    this.apiKey = options.apiKey;

    const resolved = resolveFacilitatorUrl(options);
    this.facilitatorUrl = resolved.facilitatorUrl;
    this.configReady = this.initializeConfig(resolved.configSection);
  }

  private async initializeConfig(
    configSection: "sandbox" | "production"
  ): Promise<void> {
    this.networkConfig = await loadNetworkConfig(
      this.facilitatorUrl,
      configSection
    );
    this.publicClient = createPublicClientForChain(
      this.networkConfig.rpcUrl,
      this.networkConfig.chainId
    );
  }

  private async ensureConfigReady(): Promise<NetworkConfig> {
    await this.configReady;
    if (!this.networkConfig || !this.publicClient) {
      throw new Error("Facilitator network config not loaded");
    }
    return this.networkConfig;
  }

  private async ensureWalletChain(): Promise<void> {
    if (!this.walletConnection) return;
    const cfg = await this.ensureConfigReady();

    await ensureChain(this.walletConnection.provider, {
      chainId: cfg.chainId,
      chainName: cfg.network,
      rpcUrl: cfg.rpcUrl,
      nativeCurrency: cfg.nativeCurrency,
    });
  }

  private walletChainConfig(cfg: NetworkConfig): WalletChainConfig {
    return {
      chainId: cfg.chainId,
      chainName: cfg.network,
      rpcUrl: cfg.rpcUrl,
      nativeCurrency: cfg.nativeCurrency,
    };
  }

  /** Register sandbox IDRX in MetaMask so approve Spending Cap shows a decimal amount. */
  private async ensurePaymentTokenInWallet(cfg: NetworkConfig): Promise<void> {
    if (!this.walletConnection || !this.publicClient) return;

    await ensureChain(
      this.walletConnection.provider,
      this.walletChainConfig(cfg)
    );

    const onChainMeta = await readErc20TokenMeta(
      this.publicClient,
      cfg.tokenAddress
    );
    const decimals = onChainMeta?.decimals ?? cfg.tokenDecimals;
    const symbol = onChainMeta?.symbol ?? "IDRX";

    const added = await watchErc20Asset(this.walletConnection.provider, {
      address: cfg.tokenAddress,
      symbol,
      decimals,
      chainId: cfg.chainId,
    });

    if (!added) {
      throw new WalletConnectionError(
        "token_not_added",
        "Add IDRX to MetaMask when prompted. This sandbox token must be in your wallet before approving Permit2."
      );
    }
  }

  async connectWallet(): Promise<string> {
    try {
      const cfg = await this.ensureConfigReady();
      this.walletConnection = await connectWallet();
      await this.ensureWalletChain();
      await this.ensurePaymentTokenInWallet(cfg);
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

  /** Wait for /config and return the loaded network params. */
  async getNetworkConfig(): Promise<NetworkConfig> {
    return this.ensureConfigReady();
  }

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

  async checkApproval(): Promise<{ approved: boolean; allowance: string }> {
    const cfg = await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }
    await this.ensureWalletChain();

    const result = await checkPermit2Approval(
      this.publicClient,
      cfg.tokenAddress,
      this.walletConnection.address,
      cfg.permit2Address
    );

    return {
      approved: result.approved,
      allowance: result.allowance.toString(),
    };
  }

  async requestApproval(): Promise<string> {
    const cfg = await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }
    await this.ensureWalletChain();

    this.options.onApprovalRequired?.();

    try {
      return await requestPermit2Approval(
        this.walletConnection.provider,
        cfg.tokenAddress,
        cfg.permit2Address,
        this.walletChainConfig(cfg),
        defaultPermit2ApprovalAmount(cfg.tokenDecimals),
        { symbol: "IDRX", decimals: cfg.tokenDecimals },
        this.publicClient
      );
    } catch (err) {
      if (err instanceof Permit2Error) {
        this.options.onPaymentError?.(err);
      }
      throw err;
    }
  }

  /**
   * Path 4: if allowance insufficient, prompt on-chain approve (user pays gas).
   * Never declare erc20ApprovalGasSponsoring for browser wallets.
   */
  private async ensurePermit2AllowanceBeforePay(
    idrAmount: string
  ): Promise<void> {
    const cfg = await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }

    const needs = await needsPermit2Allowance(
      this.publicClient,
      this.walletConnection.address as Address,
      cfg.tokenAddress,
      idrAmount
    );

    if (!needs) return;

    await this.ensureWalletChain();

    this.options.onApprovalRequired?.();
    await requestPermit2Approval(
      this.walletConnection.provider,
      cfg.tokenAddress,
      cfg.permit2Address,
      this.walletChainConfig(cfg),
      defaultPermit2ApprovalAmount(cfg.tokenDecimals),
      { symbol: "IDRX", decimals: cfg.tokenDecimals },
      this.publicClient
    );
  }

  private async getHttpPaymentClient(): Promise<x402HTTPClient> {
    const cfg = await this.ensureConfigReady();
    if (!this.walletConnection || !this.publicClient) {
      throw new Error("Wallet not connected");
    }
    await this.ensureWalletChain();
    if (this.httpPaymentClient) return this.httpPaymentClient;

    const chain = defineChain({
      id: cfg.chainId,
      name: cfg.network,
      nativeCurrency: cfg.nativeCurrency,
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });

    const walletClient = createWalletClient({
      chain,
      transport: custom(this.walletConnection.provider),
    });

    // Path 4: omit signTransaction — MetaMask does not support eth_signTransaction
    const signer = toClientEvmSigner(
      {
        address: this.walletConnection.address,
        signTypedData: (args) =>
          walletClient.signTypedData({
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
      `eip155:${cfg.chainId}`,
      new ExactEvmScheme(signer)
    );

    this.httpPaymentClient = new x402HTTPClient(paymentClient);
    return this.httpPaymentClient;
  }

  private async buildFallbackPaymentRequired(requirements: {
    to: string;
    amount: string;
    resource?: string;
  }): Promise<X402PaymentRequired> {
    const cfg = await this.ensureConfigReady();

    // Path 4: never declare erc20ApprovalGasSponsoring
    const extensions = buildPaymentExtensions({
      sponsorshipMode: cfg.sponsorshipMode,
      declareErc20ApprovalRelay: false,
    });

    return buildFallbackPaymentRequired({
      to: requirements.to,
      amount: requirements.amount,
      resource: requirements.resource,
      chainId: cfg.chainId,
      tokenAddress: cfg.tokenAddress,
      extensions,
    });
  }

  async pay(requirements: {
    to: string;
    amount: string;
    currency: string;
    resource?: string;
  }): Promise<PaymentResult> {
    if (this.payInFlight) {
      throw new Error("Payment already in progress");
    }
    this.payInFlight = true;

    const cfg = await this.ensureConfigReady();

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

    try {
      await this.ensurePermit2AllowanceBeforePay(requirements.amount);

      const paymentRequired = await this.buildFallbackPaymentRequired({
        to: requirements.to,
        amount: requirements.amount,
        resource: requirements.resource,
      });
      const paymentClient = await this.getHttpPaymentClient();
      const paymentPayload =
        await paymentClient.createPaymentPayload(paymentRequired);
      const settlement = await settleWithFacilitator({
        facilitatorUrl: this.facilitatorUrl,
        apiKey: this.apiKey,
        paymentPayload,
      });

      const paymentResult: PaymentResult = {
        txHash: settlement.txHash ?? "",
        from: this.walletConnection.address,
        to: requirements.to,
        token: "IDRX",
        amount: requirements.amount,
        network: cfg.network,
      };

      this.options.onPaymentSuccess?.(paymentResult);
      return paymentResult;
    } catch (err) {
      const mapped = mapWalletSignerError(err);
      this.options.onPaymentError?.(mapped);
      throw mapped;
    } finally {
      this.payInFlight = false;
    }
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, init);

    if (response.status !== 402) {
      return response;
    }

    const paymentRequired = await this.parseX402PaymentRequired(response, url);
    if (!paymentRequired) {
      return response;
    }

    if (!(await this.isWalletConnected())) {
      await this.connectWallet();
    }

    const amount = paymentRequired.accepts?.[0]?.amount;
    if (amount && this.walletConnection && this.publicClient) {
      const cfg = await this.ensureConfigReady();
      const needsApprove = await needsPermit2AllowanceBaseUnits(
        this.publicClient,
        this.walletConnection.address as Address,
        cfg.tokenAddress,
        amount
      );
      if (needsApprove) {
        await this.ensureWalletChain();
        this.options.onApprovalRequired?.();
        await requestPermit2Approval(
          this.walletConnection.provider,
          cfg.tokenAddress,
          cfg.permit2Address,
          this.walletChainConfig(cfg),
          defaultPermit2ApprovalAmount(cfg.tokenDecimals),
          { symbol: "IDRX", decimals: cfg.tokenDecimals },
          this.publicClient
        );
      }
    }

    try {
      const paymentClient = await this.getHttpPaymentClient();
      // Path 4: never declare erc20ApprovalGasSponsoring for browser wallets
      const sanitized: X402PaymentRequired = {
        ...paymentRequired,
        extensions: buildPaymentExtensions({
          sponsorshipMode: (await this.ensureConfigReady()).sponsorshipMode,
          declareErc20ApprovalRelay: false,
        }),
      };
      const paymentPayload =
        await paymentClient.createPaymentPayload(sanitized);
      await settleWithFacilitator({
        facilitatorUrl: this.facilitatorUrl,
        apiKey: this.apiKey,
        paymentPayload,
      });

      const paymentSignature = encodePaymentSignatureHeader(paymentPayload);
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set("PAYMENT-SIGNATURE", paymentSignature);
      retryHeaders.set("X-PAYMENT", paymentSignature);

      return fetch(url, {
        ...init,
        headers: retryHeaders,
      });
    } catch (err) {
      throw mapWalletSignerError(err);
    }
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

export function createBrowserClient(options: TransX402Options): BrowserClient {
  return new BrowserClient(options);
}
