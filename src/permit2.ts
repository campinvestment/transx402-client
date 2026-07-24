import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  maxUint256,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import type { EIP1193Provider, WalletChainConfig } from "./wallet.js";
import { ensureChain, watchErc20Asset } from "./wallet.js";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

const PERMIT2_ABI = parseAbi([
  "function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

const ERC20_METADATA_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/**
 * Unlimited ERC-20 approve to Permit2 (Uniswap / Permit2 standard).
 * MetaMask treats Permit2 as a trusted spender and shows "Unlimited" more
 * reliably than a finite cap on custom chains (CAMP sandbox).
 */
export const DEFAULT_PERMIT2_APPROVAL_AMOUNT = maxUint256;

/** Explicit max uint256 for integrators who want unlimited approve. */
export const UNLIMITED_PERMIT2_APPROVAL_AMOUNT = maxUint256;

/** Build approve amount for Permit2 — always unlimited. */
export function defaultPermit2ApprovalAmount(_decimals = 2): bigint {
  return UNLIMITED_PERMIT2_APPROVAL_AMOUNT;
}

/** Read token metadata from chain so MetaMask watchAsset uses verified decimals. */
export async function readErc20TokenMeta(
  publicClient: ReturnType<typeof createPublicClientForChain>,
  token: Address
): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const checksummed = getAddress(token);
    const [decimals, symbol] = await Promise.all([
      publicClient.readContract({
        address: checksummed,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: checksummed,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
    ]);
    return { decimals: Number(decimals), symbol: String(symbol) };
  } catch {
    return null;
  }
}
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
export function createPublicClientForChain(
  rpcUrl: string,
  chainId: number
): PublicClient {
  const chain = defineChain({
    id: chainId,
    name: `transx-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  }) as PublicClient;
}

/**
 * Check if Permit2 has been approved for a specific token
 */
export async function checkPermit2Approval(
  publicClient: ReturnType<typeof createPublicClientForChain>,
  token: Address,
  owner: Address,
  permit2Address: Address
): Promise<Permit2Approval> {
  try {
    // Check ERC20 allowance first
    const erc20Allowance = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, permit2Address],
    })) as bigint;

    // Check Permit2 allowance
    const permit2Allowance = await publicClient.readContract({
      address: permit2Address,
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
 * Request ERC20 approval for Permit2 contract.
 * Registers the token with MetaMask first (wallet_watchAsset) so Spending Cap
 * shows a human decimal amount instead of hex / the Permit2 spender address.
 */
export async function requestPermit2Approval(
  provider: EIP1193Provider,
  token: Address,
  permit2Address: Address,
  chainConfig: WalletChainConfig,
  amount: bigint = UNLIMITED_PERMIT2_APPROVAL_AMOUNT,
  tokenMeta?: { symbol?: string; decimals?: number },
  publicClient?: ReturnType<typeof createPublicClientForChain>
): Promise<Hex> {
  try {
    const tokenAddress = getAddress(token);
    const spender = getAddress(permit2Address);
    const rpcClient =
      publicClient ??
      createPublicClientForChain(chainConfig.rpcUrl, chainConfig.chainId);

    const onChainMeta = await readErc20TokenMeta(rpcClient, tokenAddress);
    const decimals = onChainMeta?.decimals ?? tokenMeta?.decimals ?? 2;
    const symbol = onChainMeta?.symbol ?? tokenMeta?.symbol ?? "IDRX";

    await ensureChain(provider, chainConfig);

    await watchErc20Asset(provider, {
      address: tokenAddress,
      symbol,
      decimals,
      chainId: chainConfig.chainId,
    });

    // Let MetaMask index the token before simulating approve on custom chains.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const chain: Chain = defineChain({
      id: chainConfig.chainId,
      name: chainConfig.chainName,
      nativeCurrency: chainConfig.nativeCurrency,
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    });

    // Create wallet client with custom provider
    const walletClient = createWalletClient({
      chain,
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

    // Send approval transaction: approve(spender=Permit2, amount=human decimal units)
    const hash = await walletClient.writeContract({
      account,
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
      chain,
    });

    await rpcClient.waitForTransactionReceipt({ hash });

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
  permit2Address: Address
): Promise<boolean> {
  try {
    const allowance = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, permit2Address],
    })) as bigint;

    return allowance >= requiredAmount;
  } catch {
    return false;
  }
}
