export type Chain = 'ethereum' | 'solana';
export type SecretKind = 'mnemonic' | 'private-key';

export interface NetworkConfig {
  key: string;
  chain: Chain;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  chainId?: number;
}

export interface TokenConfig {
  id: string;
  chain: Chain;
  networkKey: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export interface WalletAccount {
  id: string;
  chain: Chain;
  name: string;
  address: string;
  networkKey: string;
  derivationPath?: string;
  secretKind: SecretKind;
  createdAt: string;
}

export interface WalletPublicState {
  version: 1;
  accounts: WalletAccount[];
  networks: NetworkConfig[];
  tokens: TokenConfig[];
  updatedAt: string;
}

export interface AccountSecret {
  chain: Chain;
  kind: SecretKind;
  mnemonic?: string;
  privateKey?: string;
  derivationPath?: string;
}

export interface VaultPlain {
  version: 1;
  accounts: WalletAccount[];
  secrets: Record<string, AccountSecret>;
  createdAt: string;
  updatedAt: string;
}

export interface WalletStatus {
  exists: boolean;
  unlocked: boolean;
  accountCount: number;
  updatedAt?: string;
}

export interface ImportMnemonicRequest {
  passphrase?: string;
  mnemonic: string;
  chains: Chain[];
  accountIndex?: number;
  name?: string;
}

export interface ImportPrivateKeyRequest {
  passphrase?: string;
  chain: Chain;
  privateKey: string;
  name?: string;
}

export interface UnlockRequest {
  passphrase: string;
}

export interface BalanceRequest {
  accountId: string;
  tokenId?: string;
}

export interface BalanceResult {
  accountId: string;
  symbol: string;
  raw: string;
  formatted: string;
}

export interface TransferRequest {
  accountId: string;
  to: string;
  amount: string;
  tokenId?: string;
}

export interface TransferResult {
  accountId: string;
  chain: Chain;
  signature: string;
  explorerUrl?: string;
}

export interface SignMessageRequest {
  accountId: string;
  message: string;
}

export interface SignMessageResult {
  accountId: string;
  chain: Chain;
  address: string;
  signature: string;
}

export interface SignTransactionRequest {
  accountId: string;
  transaction: unknown;
  encoding?: 'json' | 'base64';
}

export interface SignTransactionResult {
  accountId: string;
  chain: Chain;
  signedTransaction: string;
  encoding: 'hex' | 'base64';
}
