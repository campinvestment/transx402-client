import type { Address, Hex } from "viem";

export interface EIP1193Provider {
  request: (args: {
    method: string;
    params?: unknown[];
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
 * Detect and connect to an EIP-1193 compatible wallet (MetaMask, Coinbase Wallet, etc.)
 */
export async function connectWallet(): Promise<WalletConnection> {
  if (!window.ethereum) {
    throw new WalletConnectionError(
      "no_wallet",
      "No Web3 wallet detected. Please install MetaMask or another compatible wallet."
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
      `Failed to connect wallet: ${error.message || "unknown error"}`
    );
  }
}

/**
 * Switch to a specific chain
 */
export async function switchChain(
  provider: EIP1193Provider,
  chainId: number
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (err) {
    const error = err as { code?: number };
    // 4902 means the chain hasn't been added yet
    if (error.code === 4902) {
      throw new WalletConnectionError(
        "chain_not_added",
        `Chain ${chainId} not added to wallet. Please add it manually.`
      );
    }
    throw err;
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
