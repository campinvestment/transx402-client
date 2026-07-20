import { afterEach, describe, expect, test, vi } from "vitest";
import { Paywall } from "./paywall.js";

const LOCAL_FACILITATOR_URL = "http://localhost:3402";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Paywall", () => {
  test("loads sandbox configuration from an explicit facilitator URL", async () => {
    vi.stubGlobal("document", {
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({
        style: {},
        className: "",
        innerHTML: "",
        addEventListener: () => {},
      }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sandbox: {
            rpcUrl: "http://localhost:8545",
            chainId: 1337,
            network: "sandbox",
            tokens: { IDRX: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211" },
            permit2Address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
            x402: { sponsorshipMode: "erc20ApprovalRelay" },
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    new Paywall({
      apiKey: "ipk_sandbox_test",
      selector: "#premium-content",
      price: 5000,
      merchantWallet: "0x36e97b771E2d6e1E88a5Cfb814E64F9Bbea81f91",
      facilitatorUrl: LOCAL_FACILITATOR_URL,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`${LOCAL_FACILITATOR_URL}/config`);
    });
  });
});
