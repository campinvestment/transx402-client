/**
 * @transx402/client — shared types and errors only.
 *
 * Import clients from subpaths:
 *   import { createBrowserClient } from "@transx402/client/browser";
 *   import { createAgentClient } from "@transx402/client/agent";
 */

export type {
  TransX402Options,
  TransX402Environment,
  SponsorshipMode,
  PaymentCallbacks,
  PaymentDetails,
  PaymentResult,
  PaymentRequirements,
  NetworkConfig,
  X402Network,
  X402PaymentPayload,
  X402PaymentRequired,
  X402PaymentRequirements,
} from "./types.js";

export { WalletConnectionError } from "./wallet.js";
export {
  Permit2Error,
  DEFAULT_PERMIT2_APPROVAL_AMOUNT,
  UNLIMITED_PERMIT2_APPROVAL_AMOUNT,
  defaultPermit2ApprovalAmount,
  readErc20TokenMeta,
} from "./permit2.js";

export {
  FacilitationError,
  formatFacilitationError,
  formatIdrxBaseUnits,
} from "./core/errors.js";

export {
  FACILITATOR_PRESETS,
  resolveFacilitatorUrl,
  assertApiKeyMatchesEnvironment,
  detectApiKeyFamily,
} from "./core/environment.js";
