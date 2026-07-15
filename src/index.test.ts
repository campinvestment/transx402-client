import { afterEach, describe, expect, test, vi } from "vitest";
import { TransX402Client } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TransX402Client fetch", () => {
  test("retries with x402 signature headers and preserves existing headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response("payment required", { status: 402 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new TransX402Client({
      apiKey: "ipk_sandbox_test",
      facilitatorUrl: "http://localhost:3402",
    });

    const parseSpy = vi.spyOn(client as any, "parseX402PaymentRequired");
    parseSpy.mockResolvedValue({
      x402Version: 2,
      resource: { url: "https://example.com/resource" },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:1337",
          asset: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
          amount: "1000",
          payTo: "0x36e97b771E2d6e1E88a5Cfb814E64F9Bbea81f91",
          maxTimeoutSeconds: 60,
          extra: {
            assetTransferMethod: "permit2",
            name: "IDRX",
            version: "1",
          },
        },
      ],
      extensions: {},
    });

    const paymentClientSpy = vi.spyOn(client as any, "getHttpPaymentClient");
    paymentClientSpy.mockResolvedValue({
      createPaymentPayload: vi.fn().mockResolvedValue({
        x402Version: 2,
        resource: { url: "https://example.com/resource" },
        accepted: {
          scheme: "exact",
          network: "eip155:1337",
          asset: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
          amount: "1000",
          payTo: "0x36e97b771E2d6e1E88a5Cfb814E64F9Bbea81f91",
          maxTimeoutSeconds: 60,
          extra: {
            assetTransferMethod: "permit2",
            name: "IDRX",
            version: "1",
          },
        },
        payload: {
          signature: "0x1234",
          permit2Authorization: {
            from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            permitted: {
              token: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
              amount: "1000",
            },
            spender: "0xbD9Ef36F3587D5e8b57b3F8a1AE3A327bD538fbA",
            nonce: "1",
            deadline: "9999999999",
            witness: {
              to: "0x36e97b771E2d6e1E88a5Cfb814E64F9Bbea81f91",
              validAfter: "0",
            },
          },
        },
        extensions: {},
      }),
    });
    const settleSpy = vi.spyOn(client as any, "settleWithFacilitator");
    settleSpy.mockResolvedValue({
      txHash: "0xabc",
    });

    const headers = new Headers({ Authorization: "Bearer token" });
    const response = await client.fetch("https://example.com/resource", { headers });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const retryRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    const retryHeaders = new Headers(retryRequest.headers as HeadersInit);
    expect(retryHeaders.get("Authorization")).toBe("Bearer token");
    expect(retryHeaders.get("PAYMENT-SIGNATURE")).toBeTruthy();
    expect(retryHeaders.get("X-PAYMENT")).toBe(retryHeaders.get("PAYMENT-SIGNATURE"));
    expect(retryHeaders.get("X-Payment-Hash")).toBeNull();
  });
});
