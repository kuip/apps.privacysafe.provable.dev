import { DEFAULT_NETWORK_LIST } from '@/lib/constants';
import type { NetworkConfig, TransactionHistoryEntry, TransferRequest, TransferResult, VaultPlain, WalletAccount } from '@/lib/types';

const MAX_HISTORY_ENTRIES = 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export type TransactionConfirmation = {
  status: TransferResult['status'];
  confirmedAt?: string;
  blockNumber?: number;
};

export type PendingTransactionRecovery = {
  account: WalletAccount;
  network: NetworkConfig;
  result: TransferResult;
};

export function makeTransactionHistoryEntry(
  account: WalletAccount,
  network: NetworkConfig,
  request: TransferRequest,
  result: TransferResult,
  assetSymbol: string,
): TransactionHistoryEntry {
  return {
    id: `${Date.now()}:${result.signature}`,
    accountId: account.id,
    chain: account.chain,
    networkKey: network.key,
    assetSymbol,
    status: result.status,
    amount: request.amount,
    from: account.address,
    to: request.to,
    signature: result.signature,
    txHash: result.signature,
    value: `${request.amount} ${assetSymbol}`,
    blockNumber: result.blockNumber,
    confirmedAt: result.confirmedAt,
    explorerUrl: result.explorerUrl,
    createdAt: nowIso(),
  };
}

export function addTransactionHistoryEntry(vault: VaultPlain, entry: TransactionHistoryEntry): void {
  vault.history = [entry, ...(vault.history ?? [])].slice(0, MAX_HISTORY_ENTRIES);
}

export function updatePendingTransaction(
  vault: VaultPlain,
  account: WalletAccount,
  network: NetworkConfig,
  result: TransferResult,
  confirmation: TransactionConfirmation,
): boolean {
  const entry = (vault.history ?? []).find(item => (
    item.accountId === account.id
    && item.networkKey === network.key
    && item.signature === result.signature
  ));
  if (!entry) {
    return false;
  }
  entry.status = confirmation.status;
  entry.confirmedAt = confirmation.confirmedAt;
  entry.blockNumber = confirmation.blockNumber ?? entry.blockNumber;
  return true;
}

export function markStalePendingTransactions(vault: VaultPlain, maxAgeMs: number): boolean {
  const now = Date.now();
  let changed = false;
  for (const entry of vault.history ?? []) {
    if (entry.status !== 'pending') {
      continue;
    }
    const createdAt = Date.parse(entry.createdAt);
    if (!Number.isNaN(createdAt) && now - createdAt > maxAgeMs) {
      entry.status = 'not_included';
      changed = true;
    }
  }
  return changed;
}

export function pendingTransactionRecoveries(vault: VaultPlain, maxAgeMs: number): PendingTransactionRecovery[] {
  const now = Date.now();
  const recoveries: PendingTransactionRecovery[] = [];
  for (const entry of vault.history ?? []) {
    if (entry.status !== 'pending') {
      continue;
    }
    const createdAt = Date.parse(entry.createdAt);
    if (!Number.isNaN(createdAt) && now - createdAt > maxAgeMs) {
      continue;
    }
    const account = vault.accounts.find(item => item.id === entry.accountId);
    const network = [...DEFAULT_NETWORK_LIST].find(item => (
      item.key === entry.networkKey
      && item.chain === entry.chain
    )) as NetworkConfig | undefined;
    if (!account || !network) {
      continue;
    }
    recoveries.push({
      account,
      network,
      result: {
        accountId: entry.accountId,
        chain: entry.chain,
        signature: entry.signature,
        status: 'pending',
        explorerUrl: entry.explorerUrl,
      },
    });
  }
  return recoveries;
}
