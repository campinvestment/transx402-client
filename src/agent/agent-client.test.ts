import { afterEach, describe, expect, test, vi } from "vitest";
import { createAgentClient, AgentClient } from "./agent-client.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSandboxConfig() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
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
    )
  );
}

describe("AgentClient Path 3", () => {
  test("declares erc20ApprovalGasSponsoring when allowance is insufficient", async () => {
    stubSandboxConfig();

    const client = createAgentClient({
      apiKey: "ipk_sandbox_test",
      facilitatorUrl: "http://localhost:3402",
      privateKey: ANVIL_KEY,
    });
    await (client as any).ensureConfigReady();

    (client as any).publicClient = {
      readContract: vi.fn().mockResolvedValue(0n),
    };

    const paymentRequired = await (client as any).buildFallbackPaymentRequired({
      to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      amount: "5000",
    });

    expect(paymentRequired.extensions).toHaveProperty(
      "erc20ApprovalGasSponsoring"
    );
  });

  test("omits erc20ApprovalGasSponsoring when allowance is sufficient", async () => {
    stubSandboxConfig();

    const client = createAgentClient({
      apiKey: "ipk_sandbox_test",
      facilitatorUrl: "http://localhost:3402",
      privateKey: ANVIL_KEY,
    });
    await (client as any).ensureConfigReady();

    (client as any).publicClient = {
      readContract: vi.fn().mockResolvedValue(10n ** 18n),
    };

    const paymentRequired = await (client as any).buildFallbackPaymentRequired({
      to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      amount: "5000",
    });

    expect(paymentRequired.extensions).not.toHaveProperty(
      "erc20ApprovalGasSponsoring"
    );
  });

  test("wires signTransaction on Path 3 signer", async () => {
    stubSandboxConfig();

    const client = createAgentClient({
      apiKey: "ipk_sandbox_test",
      facilitatorUrl: "http://localhost:3402",
      privateKey: ANVIL_KEY,
    });
    await (client as any).ensureConfigReady();
    expect(client).toBeInstanceOf(AgentClient);

    const dir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(dir, "agent-client.ts"), "utf8");
    expect(source).toMatch(/signTransaction:/);
    expect(source).toMatch(/Path 3/);
  });
});
