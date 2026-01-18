export interface WalletAccount {
  address: string;
  chainId: number;
  accountType: "local" | "erc4337";
  provider: string;
  ownerAddress?: string;
  entryPoint?: string;
  factory?: string;
  paymaster?: string;
  bundler?: string;
  salt?: string;
}

export interface WalletProvider {
  getAccount(userId: string): WalletAccount;
}

export const WALLET_PROVIDER = Symbol("WALLET_PROVIDER");
