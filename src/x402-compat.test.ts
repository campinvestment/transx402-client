import { describe, expect, test } from "vitest";
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { isPermit2Payload, type ExactEvmPayloadV2 } from "@x402/evm";
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from "@x402/extensions";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";

const exactRequirement = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22",
  amount: "100",
  payTo: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  maxTimeoutSeconds: 60,
  extra: {
    assetTransferMethod: "permit2",
    name: "IDRX",
    version: "1",
  },
} satisfies PaymentRequired["accepts"][number];

describe("x402 compatibility", () => {
  test("round-trips payment-required and payment-signature headers", () => {
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      resource: { url: "https://example.com/premium-article" },
      accepts: [exactRequirement],
      extensions: {
        ...declareEip2612GasSponsoringExtension(),
        ...declareErc20ApprovalGasSponsoringExtension(),
      },
    };

    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      resource: { url: "https://example.com/premium-article" },
      accepted: exactRequirement,
      payload: {
        signature: "0x1234",
        permit2Authorization: {
          from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          permitted: {
            token: exactRequirement.asset,
            amount: exactRequirement.amount,
          },
          spender: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          nonce: "1",
          deadline: "9999999999",
          witness: {
            to: exactRequirement.payTo,
            validAfter: "0",
          },
        },
      },
      extensions: {},
    };

    const requiredHeader = encodePaymentRequiredHeader(paymentRequired);
    const signatureHeader = encodePaymentSignatureHeader(paymentPayload);

    const decodedRequired = decodePaymentRequiredHeader(requiredHeader);
    const decodedSignature = decodePaymentSignatureHeader(signatureHeader);

    expect(decodedRequired.x402Version).toBe(2);
    expect(decodedRequired.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      extra: { assetTransferMethod: "permit2" },
    });
    expect(decodedSignature.accepted).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      asset: exactRequirement.asset,
    });
    expect(
      isPermit2Payload(decodedSignature.payload as ExactEvmPayloadV2)
    ).toBe(true);
  });
});
