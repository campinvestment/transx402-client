/**
 * Structured error from POST /facilitate — preserves API error.code for integrators.
 */
export class FacilitationError extends Error {
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, string>
  ) {
    super(message);
    this.name = "FacilitationError";
    this.code = code;
    this.details = details;
  }
}

/** Format IDRX base units (2 decimals) as a human IDR amount, e.g. "5,000". */
export function formatIdrxBaseUnits(baseUnits: string): string {
  try {
    const whole = BigInt(baseUnits) / 100n;
    return whole.toLocaleString("en-US");
  } catch {
    return baseUnits;
  }
}

/** User-facing copy for facilitation failures (paywall / alerts). */
export function formatFacilitationError(error: FacilitationError): string {
  const { code, details, message } = error;

  if (code === "insufficient_balance") {
    const required = details?.required
      ? formatIdrxBaseUnits(details.required)
      : null;
    const available = details?.available
      ? formatIdrxBaseUnits(details.available)
      : null;

    if (required != null && available != null) {
      return (
        `Insufficient IDRX balance. You need Rp ${required} but only have Rp ${available}. ` +
        "Fund your wallet via Dashboard → Sandbox or POST /sandbox/fund."
      );
    }
    return (
      "Insufficient IDRX balance. " +
      "Fund your wallet via Dashboard → Sandbox or POST /sandbox/fund."
    );
  }

  if (code === "no_permit2_approval") {
    return (
      "Permit2 approval is missing or too low for this payment. " +
      "Approve IDRX spending for Permit2, then try again."
    );
  }

  if (details?.errorReason) {
    return `${message} (${details.errorReason})`;
  }

  if (code && code !== "facilitation_failed") {
    return `${message} [${code}]`;
  }

  return message;
}
