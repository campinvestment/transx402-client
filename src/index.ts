import type { IndoPay402Options, PaymentRequirements, PaymentResult } from "./types.js";

export type { IndoPay402Options, PaymentDetails, PaymentResult, PaymentRequirements } from "./types.js";

const FACILITATOR_URLS = {
  sandbox: "https://sandbox.indopay402.xyz",
  production: "https://api.indopay402.xyz",
} as const;

function detectEnvironment(apiKey: string): "sandbox" | "production" {
  if (apiKey.startsWith("ipk_sandbox_")) return "sandbox";
  if (apiKey.startsWith("ipk_live_")) return "production";
  throw new Error(`Invalid API key prefix. Expected ipk_sandbox_ or ipk_live_`);
}

export class IndoPay402Client {
  private apiKey: string;
  private facilitatorUrl: string;
  private options: IndoPay402Options;

  constructor(options: IndoPay402Options) {
    this.options = options;
    this.apiKey = options.apiKey;

    const env = detectEnvironment(options.apiKey);
    this.facilitatorUrl = options.facilitatorUrl ?? FACILITATOR_URLS[env];
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

    this.options.onPaymentStart?.({
      to: requirements.to,
      amount: requirements.amount,
      currency: requirements.currency,
      resource: url,
    });

    // TODO: Phase 2 — wallet connection, Permit2 signing, payment submission
    throw new Error(
      "Payment flow not yet implemented. Wallet connection and Permit2 signing coming in Phase 2."
    );
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

export default IndoPay402;
