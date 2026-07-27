import { describe, expect, test, vi, afterEach } from "vitest";
import {
  FacilitationError,
  formatFacilitationError,
  formatIdrxBaseUnits,
} from "./errors.js";
import { settleWithFacilitator } from "./payment-flow.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("formatIdrxBaseUnits", () => {
  test("converts base units to whole IDR with grouping", () => {
    expect(formatIdrxBaseUnits("500000")).toBe("5,000");
    expect(formatIdrxBaseUnits("0")).toBe("0");
    expect(formatIdrxBaseUnits("100")).toBe("1");
  });
});

describe("formatFacilitationError", () => {
  test("formats insufficient_balance with required and available", () => {
    const err = new FacilitationError(
      "insufficient_balance",
      "Payer IDRX balance is below required amount",
      { required: "500000", available: "120000" }
    );
    expect(formatFacilitationError(err)).toContain("Rp 5,000");
    expect(formatFacilitationError(err)).toContain("Rp 1,200");
    expect(formatFacilitationError(err)).toMatch(/Insufficient IDRX balance/i);
  });

  test("formats insufficient_balance without details", () => {
    const err = new FacilitationError(
      "insufficient_balance",
      "Payer IDRX balance is below required amount"
    );
    expect(formatFacilitationError(err)).toMatch(/Insufficient IDRX balance/i);
    expect(formatFacilitationError(err)).toMatch(/sandbox\/fund/i);
  });

  test("formats no_permit2_approval", () => {
    const err = new FacilitationError(
      "no_permit2_approval",
      "Payer hasn't approved Permit2"
    );
    expect(formatFacilitationError(err)).toMatch(/Permit2/i);
  });

  test("falls back to message for unknown codes", () => {
    const err = new FacilitationError("weird", "Something odd happened");
    expect(formatFacilitationError(err)).toBe("Something odd happened");
  });
});

describe("settleWithFacilitator", () => {
  test("throws FacilitationError preserving code and details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "insufficient_balance",
              message: "Payer IDRX balance is below required amount",
              details: { required: "500000", available: "0" },
            },
          }),
          { status: 400 }
        )
      )
    );

    await expect(
      settleWithFacilitator({
        facilitatorUrl: "http://localhost:3402",
        apiKey: "ipk_sandbox_test",
        paymentPayload: {
          x402Version: 2,
          resource: { url: "https://example.com" },
          accepted: {
            scheme: "exact",
            network: "eip155:1337",
            asset: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
            amount: "500000",
            payTo: "0x36e97b771E2d6e1E88a5Cfb814E64F9Bbea81f91",
            maxTimeoutSeconds: 60,
          },
          payload: {},
          extensions: {},
        } as never,
      })
    ).rejects.toMatchObject({
      name: "FacilitationError",
      code: "insufficient_balance",
      details: { required: "500000", available: "0" },
    });
  });
});
