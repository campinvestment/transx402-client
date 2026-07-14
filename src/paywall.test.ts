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
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
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
