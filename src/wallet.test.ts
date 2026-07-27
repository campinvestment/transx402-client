import { describe, expect, test, vi } from "vitest";
import {
  hasErc20Balance,
  watchErc20Asset,
  type EIP1193Provider,
} from "./wallet.js";

describe("hasErc20Balance", () => {
  test("returns true when balance > 0", async () => {
    const reader = {
      readContract: vi.fn().mockResolvedValue(1000n),
    };
    const result = await hasErc20Balance(
      reader,
      "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    expect(result).toBe(true);
    expect(reader.readContract).toHaveBeenCalledOnce();
  });

  test("returns false when balance is 0", async () => {
    const reader = {
      readContract: vi.fn().mockResolvedValue(0n),
    };
    const result = await hasErc20Balance(
      reader,
      "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
    expect(result).toBe(false);
  });
});

describe("watchErc20Asset", () => {
  test("skips wallet_watchAsset when balanceReader shows non-zero balance", async () => {
    const request = vi.fn();
    const provider = { request } as EIP1193Provider;

    const added = await watchErc20Asset(provider, {
      address: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
      symbol: "IDRX",
      decimals: 2,
      chainId: 1337,
      userAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      balanceReader: {
        readContract: vi.fn().mockResolvedValue(5000n),
      },
    });

    expect(added).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  test("calls wallet_watchAsset when balance is zero", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const provider = { request } as EIP1193Provider;

    await watchErc20Asset(provider, {
      address: "0xBDc7a77b5D1A036Ba057358e4156b3646c5c1211",
      symbol: "IDRX",
      decimals: 2,
      chainId: 1337,
      userAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      balanceReader: {
        readContract: vi.fn().mockResolvedValue(0n),
      },
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_watchAsset" })
    );
  });
});
