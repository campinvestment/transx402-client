export { createBrowserClient, BrowserClient } from "./browser-client.js";
export { Paywall, createPaywall, type PaywallOptions } from "../paywall.js";
export type {
  TransX402Options,
  TransX402Environment,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
} from "../types.js";
export { WalletConnectionError } from "../wallet.js";
export { Permit2Error } from "../permit2.js";

import { createBrowserClient } from "./browser-client.js";
import { createPaywall, type PaywallOptions } from "../paywall.js";
import type { TransX402Options } from "../types.js";

/** CDN / browser-bundle namespace (Path 4). */
export const TransX402 = {
  create(options: TransX402Options) {
    return createBrowserClient(options);
  },
  paywall(options: PaywallOptions) {
    return createPaywall(options);
  },
};

export default TransX402;
