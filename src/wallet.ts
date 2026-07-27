import { getAddress, parseAbi, type Address, type Hex } from "viem";

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/** Minimal reader for ERC-20 balanceOf — use publicClient, not MetaMask eth_call. */
export interface Erc20BalanceReader {
  readContract(args: {
    address: Address;
    abi: typeof ERC20_BALANCE_ABI;
    functionName: "balanceOf";
    args: [Address];
  }): Promise<bigint>;
}

export interface EIP1193Provider {
  request: (args: {
    method: string;
    params?: unknown;
  }) => Promise<unknown>;
  on?: (event: string, callback: (data: unknown) => void) => void;
  removeListener?: (event: string, callback: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export interface WalletConnection {
  address: Address;
  provider: EIP1193Provider;
  chainId: number;
}

export interface WalletChainConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export class WalletConnectionError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "WalletConnectionError";
  }
}

/**
 * True when the user holds a non-zero ERC-20 balance on the configured RPC.
 * Uses publicClient (direct RPC), not MetaMask eth_call — the provider path
 * often fails silently on custom chains and caused spurious watchAsset prompts.
 */
export async function hasErc20Balance(
  reader: Erc20BalanceReader,
  tokenAddress: Address,
  userAddress: Address
): Promise<boolean> {
  try {
    const balance = await readErc20Balance(reader, tokenAddress, userAddress);
    return balance > 0n;
  } catch {
    return false;
  }
}

/** Read ERC-20 balanceOf via publicClient. */
export async function readErc20Balance(
  reader: Erc20BalanceReader,
  tokenAddress: Address,
  userAddress: Address
): Promise<bigint> {
  return reader.readContract({
    address: getAddress(tokenAddress),
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [getAddress(userAddress)],
  });
}

/**
 * Suggest MetaMask add an ERC-20 so Spending Cap UI knows decimals/symbol.
 * If the user already holds a non-zero balance the prompt is skipped,
 * since MetaMask auto-detects tokens with balance.
 * Safe to call repeatedly; user may dismiss. Never throws on rejection.
 */
export async function watchErc20Asset(
  provider: EIP1193Provider,
  options: {
    address: Address;
    symbol: string;
    decimals: number;
    chainId?: number;
    image?: string;
    userAddress?: Address;
    balanceReader?: Erc20BalanceReader;
  }
): Promise<boolean> {
  try {
    if (options.userAddress && options.balanceReader) {
      const hasBalance = await hasErc20Balance(
        options.balanceReader,
        options.address,
        options.userAddress
      );
      if (hasBalance) return true;
    }

    const added = await provider.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: getAddress(options.address),
          symbol: options.symbol,
          decimals: options.decimals,
          ...(options.chainId != null ? { chainId: options.chainId } : {}),
          ...(options.image ? { image: options.image } : {}),
        },
      },
    });
    return added === true;
  } catch {
    return false;
  }
}

/**
 * Connect to MetaMask via window.ethereum (EIP-1193).
 * Multi-wallet picker (EIP-6963) is intentionally not supported yet —
 * disable other extensions or use Incognito with only MetaMask if connect fails.
 */
export async function connectWallet(): Promise<WalletConnection> {
  if (!window.ethereum) {
    throw new WalletConnectionError(
      "no_wallet",
      "No MetaMask detected. Install MetaMask, then reload this page."
    );
  }

  try {
    // Request account access
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as Address[];

    if (!accounts || accounts.length === 0) {
      throw new WalletConnectionError(
        "rejected",
        "Wallet connection was rejected by the user"
      );
    }

    const address = accounts[0];

    // Get current chain ID
    const chainId = (await window.ethereum.request({
      method: "eth_chainId",
    })) as string;

    return {
      address,
      provider: window.ethereum,
      chainId: parseInt(chainId, 16),
    };
  } catch (err) {
    if (err instanceof WalletConnectionError) throw err;
    
    const error = err as { code?: number; message?: string };
    if (error.code === 4001) {
      throw new WalletConnectionError(
        "rejected",
        "Wallet connection was rejected by the user"
      );
    }
    throw new WalletConnectionError(
      "connection_failed",
      `Failed to connect MetaMask: ${error.message || "unknown error"}. ` +
        "If multiple wallet extensions are installed, disable all except MetaMask " +
        "or use an Incognito window with only MetaMask enabled."
    );
  }
}

/**
 * Switch to a specific chain
 */
export async function switchChain(
  provider: EIP1193Provider,
  config: WalletChainConfig
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${config.chainId.toString(16)}` }],
    });
  } catch (err) {
    const error = err as { code?: number };
    // 4902 means the chain hasn't been added yet
    if (error.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${config.chainId.toString(16)}`,
            chainName: config.chainName,
            rpcUrls: [config.rpcUrl],
            nativeCurrency: config.nativeCurrency,
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${config.chainId.toString(16)}` }],
      });
      return;
    }
    throw err;
  }
}

export async function ensureChain(
  provider: EIP1193Provider,
  config: WalletChainConfig
): Promise<void> {
  const currentChainId = (await provider.request({
    method: "eth_chainId",
  })) as string;

  if (parseInt(currentChainId, 16) !== config.chainId) {
    await switchChain(provider, config);
  }
}

/**
 * Sign a message with the connected wallet
 */
export async function signMessage(
  provider: EIP1193Provider,
  message: string,
  address: Address
): Promise<Hex> {
  try {
    const signature = (await provider.request({
      method: "personal_sign",
      params: [message, address],
    })) as Hex;

    return signature;
  } catch (err) {
    const error = err as { code?: number; message?: string };
    if (error.code === 4001) {
      throw new WalletConnectionError(
        "rejected",
        "Message signing was rejected by the user"
      );
    }
    throw new WalletConnectionError(
      "sign_failed",
      `Failed to sign message: ${error.message || "unknown error"}`
    );
  }
}

/**
 * Check if wallet is still connected
 */
export async function checkConnection(provider: EIP1193Provider): Promise<Address | null> {
  try {
    const accounts = (await provider.request({
      method: "eth_accounts",
    })) as Address[];
    
    return accounts[0] || null;
  } catch {
    return null;
  }
}
