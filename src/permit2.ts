import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import type { EIP1193Provider } from "./wallet.js";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

const PERMIT2_ABI = parseAbi([
  "function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

export interface Permit2Approval {
  approved: boolean;
  allowance: bigint;
  expiration: number;
  nonce: number;
}

export interface ApprovalRequest {
  token: Address;
  spender: Address;
  amount: bigint;
}

export class Permit2Error extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "Permit2Error";
  }
}

/**
 * Create a viem public client for reading from the blockchain
 */
export function createPublicClientForChain(rpcUrl: string) {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

/**
 * Check if Permit2 has been approved for a specific token
 */
export async function checkPermit2Approval(
  publicClient: ReturnType<typeof createPublicClientForChain>,
  token: Address,
  owner: Address,
  spender: Address = PERMIT2_ADDRESS
): Promise<Permit2Approval> {
  try {
    // Check ERC20 allowance first
    const erc20Allowance = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;

    // Check Permit2 allowance
    const permit2Allowance = await publicClient.readContract({
      address: PERMIT2_ADDRESS,
      abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [owner, token, owner], // spender is the owner for self-transfer
    }).catch(() => [0n, 0, 0] as [bigint, number, number]);

    const [amount, expiration, nonce] = permit2Allowance as [bigint, number, number];

    return {
      approved: erc20Allowance > 0n,
      allowance: erc20Allowance,
      expiration,
      nonce,
    };
  } catch (err) {
    throw new Permit2Error(
      "check_failed",
      `Failed to check Permit2 approval: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }
}

/**
 * Request ERC20 approval for Permit2 contract
 */
export async function requestPermit2Approval(
  provider: EIP1193Provider,
  token: Address,
  amount: bigint = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"), // max uint256
  rpcUrl?: string
): Promise<Hex> {
  try {
    // Create wallet client with custom provider
    const walletClient = createWalletClient({
      chain: base,
      transport: custom(provider),
    });

    // Get the connected account
    const accounts = (await provider.request({
      method: "eth_requestAccounts",
    })) as Address[];

    if (!accounts || accounts.length === 0) {
      throw new Permit2Error("no_account", "No wallet account connected");
    }

    const account = accounts[0];

    // Send approval transaction
    const hash = await walletClient.writeContract({
      account,
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, amount],
      chain: base,
    });

    // Wait for the transaction to be mined
    if (rpcUrl) {
      const publicClient = createPublicClientForChain(rpcUrl);
      await publicClient.waitForTransactionReceipt({ hash });
    }

    return hash;
  } catch (err) {
    if (err instanceof Permit2Error) throw err;
    
    const error = err as { code?: number; message?: string };
    if (error.code === 4001) {
      throw new Permit2Error(
        "rejected",
        "Token approval was rejected by the user"
      );
    }
    throw new Permit2Error(
      "approval_failed",
      `Failed to approve token: ${error.message || "unknown error"}`
    );
  }
}

/**
 * Check if a specific amount is approved for Permit2
 */
export async function isAmountApproved(
  publicClient: ReturnType<typeof createPublicClientForChain>,
  token: Address,
  owner: Address,
  requiredAmount: bigint,
  spender: Address = PERMIT2_ADDRESS
): Promise<boolean> {
  try {
    const allowance = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;

    return allowance >= requiredAmount;
  } catch {
    return false;
  }
}
