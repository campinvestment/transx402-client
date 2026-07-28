import type {
  PaymentResult,
  PaymentRequirements,
  SettlementMode,
  TransX402Options,
  X402PaymentRequired,
  NetworkConfig,
} from "../types.js";
import { createPublicClientForChain } from "../permit2.js";
import {
  createWalletClient,
  http,
  defineChain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { resolveFacilitatorUrl, requireApiKeyForDirectSettlement } from "../core/environment.js";
import { loadNetworkConfig } from "../core/config.js";
import { needsPermit2Allowance, needsPermit2AllowanceBaseUnits } from "../core/allowance.js";
import {
  buildFallbackPaymentRequired,
  buildPaymentExtensions,
  settleWithFacilitator,
} from "../core/payment-flow.js";

export type AgentClientOptions = TransX402Options & {
  /** Hex private key for the agent EVM signer (Path 3). */
  privateKey: Hex;
};

/**
 * Agent / Node client — Path 3 (sponsored Permit2 approve via signTransaction).
 * Requires a private-key signer that supports eth_signTransaction.
 */
export class AgentClient {
  private apiKey: string | undefined;
  private facilitatorUrl: string;
  private options: AgentClientOptions;
  /** Settlement for `fetch()` only. `pay()` always settles directly. */
  private fetchSettlement: SettlementMode;
  private account;
  private publicClient: ReturnType<typeof createPublicClientForChain> | null =
    null;
  private networkConfig: NetworkConfig | null = null;
  private configReady: Promise<void>;
  private httpPaymentClient: x402HTTPClient | null = null;

  constructor(options: AgentClientOptions) {
    this.options = options;
    this.apiKey = "apiKey" in options ? options.apiKey : undefined;
    this.fetchSettlement = options.settlement ?? "server";
    this.account = privateKeyToAccount(options.privateKey);

    const resolved = resolveFacilitatorUrl(options);
    this.facilitatorUrl = resolved.facilitatorUrl;
    this.configReady = this.initializeConfig(resolved.configSection);
  }

  get address(): Address {
    return this.account.address;
  }

  /** Wait for /config and return the loaded network params. */
  async getNetworkConfig(): Promise<NetworkConfig> {
    return this.ensureConfigReady();
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

  private async getHttpPaymentClient(): Promise<x402HTTPClient> {
    const cfg = await this.ensureConfigReady();
    if (this.httpPaymentClient) return this.httpPaymentClient;

    const chain = defineChain({
      id: cfg.chainId,
      name: cfg.network,
      nativeCurrency: cfg.nativeCurrency,
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });

    const walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(cfg.rpcUrl),
    });

    // Path 3: wire signTransaction for erc20ApprovalGasSponsoring
    const signer = toClientEvmSigner(
      {
        address: this.account.address,
        signTypedData: (args) =>
          walletClient.signTypedData({
            ...args,
            account: this.account,
          }),
        signTransaction: (args) =>
          walletClient.signTransaction({
            ...args,
            account: this.account,
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

    const needsRelay =
      cfg.sponsorshipMode === "erc20ApprovalRelay" &&
      (await needsPermit2Allowance(
        this.publicClient!,
        this.account.address,
        cfg.tokenAddress,
        requirements.amount
      ));

    const extensions = buildPaymentExtensions({
      sponsorshipMode: cfg.sponsorshipMode,
      declareErc20ApprovalRelay: needsRelay,
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
    const cfg = await this.ensureConfigReady();

    this.options.onPaymentStart?.({
      to: requirements.to,
      amount: requirements.amount,
      currency: requirements.currency,
      resource: requirements.resource,
    });

    try {
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
        apiKey: requireApiKeyForDirectSettlement(this.apiKey, "AgentClient.pay()"),
        paymentPayload,
      });

      const paymentResult: PaymentResult = {
        txHash: settlement.txHash ?? "",
        from: this.account.address,
        to: requirements.to,
        token: "IDRX",
        amount: requirements.amount,
        network: cfg.network,
      };

      this.options.onPaymentSuccess?.(paymentResult);
      return paymentResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onPaymentError?.(error);
      throw error;
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

    const cfg = await this.ensureConfigReady();
    const amount = paymentRequired.accepts?.[0]?.amount;
    let declareRelay = false;
    if (amount) {
      declareRelay = await needsPermit2AllowanceBaseUnits(
        this.publicClient!,
        this.account.address,
        cfg.tokenAddress,
        amount
      );
    }

    const paymentClient = await this.getHttpPaymentClient();
    const withExtensions: X402PaymentRequired = {
      ...paymentRequired,
      extensions: buildPaymentExtensions({
        sponsorshipMode: cfg.sponsorshipMode,
        declareErc20ApprovalRelay:
          cfg.sponsorshipMode === "erc20ApprovalRelay" && declareRelay,
      }),
    };

    const paymentPayload =
      await paymentClient.createPaymentPayload(withExtensions);

    if (this.fetchSettlement === "direct") {
      await settleWithFacilitator({
        facilitatorUrl: this.facilitatorUrl,
        apiKey: requireApiKeyForDirectSettlement(
          this.apiKey,
          'AgentClient.fetch() with settlement: "direct"'
        ),
        paymentPayload,
      });
    }

    const paymentSignature = encodePaymentSignatureHeader(paymentPayload);
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("PAYMENT-SIGNATURE", paymentSignature);
    retryHeaders.set("X-PAYMENT", paymentSignature);

    return fetch(url, {
      ...init,
      headers: retryHeaders,
    });
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
        // fall through
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

export function createAgentClient(options: AgentClientOptions): AgentClient {
  return new AgentClient(options);
}
