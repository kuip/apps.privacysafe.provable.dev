export type Chain = 'ethereum' | 'solana';
export type SecretKind = 'mnemonic' | 'private-key';
export type NetworkEnvironment = 'production' | 'development';

export interface NetworkConfig {
  key: string;
  chain: Chain;
  name: string;
  environment: NetworkEnvironment;
  nativeSymbol: string;
  rpcUrl: string;
  rpcUrls?: readonly string[];
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
  networkKey?: string;
  derivationPath?: string;
  secretKind: SecretKind;
  createdAt: string;
}

export interface WalletPublicState {
  version: 1;
  accounts: WalletAccount[];
  networks: NetworkConfig[];
  tokens: TokenConfig[];
  history: TransactionHistoryEntry[];
  settings: WalletSettings;
  updatedAt: string;
}

export interface WalletSettings {
  requirePasswordForTransfers: boolean;
  requirePasswordForMessageSigning: boolean;
  requirePasswordForTransactionSigning: boolean;
  enableDevelopmentNetworks: boolean;
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
  history: TransactionHistoryEntry[];
  settings: WalletSettings;
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

export interface ChangePassphraseRequest {
  currentPassphrase: string;
  newPassphrase: string;
}

export interface ResetVaultRequest {
  passphrase: string;
}

export interface RevealRecoveryPhraseRequest {
  accountId: string;
  passphrase: string;
}

export interface RevealRecoveryPhraseResult {
  accountId: string;
  mnemonic: string;
  derivationPath?: string;
}

export interface BalanceRequest {
  accountId: string;
  networkKey?: string;
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
  networkKey?: string;
  to: string;
  amount: string;
  tokenId?: string;
  passphrase?: string;
}

export interface TransferResult {
  accountId: string;
  chain: Chain;
  signature: string;
  status: TransactionStatus;
  blockNumber?: number;
  confirmedAt?: string;
  explorerUrl?: string;
}

export type TransactionStatus = 'pending' | 'success' | 'failed' | 'not_included';

export interface TransactionHistoryEntry {
  id: string;
  accountId: string;
  chain: Chain;
  networkKey: string;
  status?: TransactionStatus;
  assetSymbol: string;
  amount: string;
  from?: string;
  to: string;
  signature: string;
  txHash?: string;
  value?: string;
  blockNumber?: number;
  confirmedAt?: string;
  explorerUrl?: string;
  createdAt: string;
}

export interface SignMessageRequest {
  accountId: string;
  message: string;
  passphrase?: string;
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
  passphrase?: string;
}

export interface SignTransactionResult {
  accountId: string;
  chain: Chain;
  signedTransaction: string;
  encoding: 'hex' | 'base64';
}
