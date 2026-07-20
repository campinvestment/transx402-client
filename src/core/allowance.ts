import type { Address } from "viem";
import { CANONICAL_PERMIT2_ADDRESS } from "./config.js";
import { toIDRXBaseUnits } from "./payment-flow.js";
import type { createPublicClientForChain } from "../permit2.js";

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export async function needsPermit2Allowance(
  publicClient: ReturnType<typeof createPublicClientForChain>,
  owner: Address,
  token: Address,
  idrAmount: string
): Promise<boolean> {
  return needsPermit2AllowanceBaseUnits(
    publicClient,
    owner,
    token,
    toIDRXBaseUnits(idrAmount)
  );
}

/** Compare ERC-20 Permit2 allowance against an amount already in IDRX base units. */
export async function needsPermit2AllowanceBaseUnits(
  publicClient: ReturnType<typeof createPublicClientForChain>,
  owner: Address,
  token: Address,
  baseUnitsAmount: string
): Promise<boolean> {
  try {
    const allowance = await publicClient.readContract({
      address: token,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [owner, CANONICAL_PERMIT2_ADDRESS],
    });
    return allowance < BigInt(baseUnitsAmount);
  } catch {
    return true;
  }
}
