import { describe, expect, it, vi } from 'vitest';
import {
  addTransactionHistoryEntry,
  makeTransactionHistoryEntry,
  markStalePendingTransactions,
  pendingTransactionRecoveries,
  updatePendingTransaction,
} from '@/lib/history-manager';
import { DEFAULT_NETWORKS } from '@/lib/constants';
import { makeAccount, makePublicState } from '@/test/fixtures';
import type { NetworkConfig, TransferResult } from '@/lib/types';

describe('transaction history status changes', () => {
  it('adds newest entries first and caps history at 1000 entries', () => {
    const state = makePublicState();

    for (let i = 0; i < 1005; i += 1) {
      addTransactionHistoryEntry(state, {
        id: `tx-${i}`,
        accountId: 'account',
        chain: 'ethereum',
        networkKey: 'ethereum:mainnet',
        status: 'pending',
        assetSymbol: 'ETH',
        amount: String(i),
        to: '0x0000000000000000000000000000000000000001',
        signature: `0x${i}`,
        createdAt: new Date(i).toISOString(),
      });
    }

    expect(state.history).toHaveLength(1000);
    expect(state.history[0].id).toBe('tx-1004');
    expect(state.history.at(-1)?.id).toBe('tx-5');
  });

  it('creates a pending transfer entry and updates it to success', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    try {
      const state = makePublicState();
      const account = makeAccount();
      const network = DEFAULT_NETWORKS.ethereum as NetworkConfig;
      const result: TransferResult = {
        accountId: account.id,
        chain: account.chain,
        signature: '0xabc',
        status: 'pending',
        explorerUrl: 'https://etherscan.io/tx/0xabc',
      };
      const entry = makeTransactionHistoryEntry(account, network, {
        accountId: account.id,
        to: '0x0000000000000000000000000000000000000001',
        amount: '0.5',
      }, result, 'ETH');

      addTransactionHistoryEntry(state, entry);

      expect(state.history[0]).toMatchObject({
        status: 'pending',
        value: '0.5 ETH',
        txHash: '0xabc',
        from: account.address,
      });
      expect(updatePendingTransaction(state, account, network, result, {
        status: 'success',
        blockNumber: 123,
        confirmedAt: '2026-01-02T03:05:05.000Z',
      })).toBe(true);
      expect(state.history[0]).toMatchObject({
        status: 'success',
        blockNumber: 123,
        confirmedAt: '2026-01-02T03:05:05.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks old pending transactions not_included and returns bounded recoveries for fresh pending transactions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T00:00:00.000Z'));
    try {
      const account = makeAccount();
      const state = makePublicState({
        accounts: [account],
        history: [
          {
            id: 'fresh',
            accountId: account.id,
            chain: 'ethereum',
            networkKey: 'ethereum:mainnet',
            status: 'pending',
            assetSymbol: 'ETH',
            amount: '1',
            to: '0x0000000000000000000000000000000000000001',
            signature: '0xfresh',
            createdAt: '2026-01-02T23:59:00.000Z',
          },
          {
            id: 'old',
            accountId: account.id,
            chain: 'ethereum',
            networkKey: 'ethereum:mainnet',
            status: 'pending',
            assetSymbol: 'ETH',
            amount: '1',
            to: '0x0000000000000000000000000000000000000001',
            signature: '0xold',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      expect(markStalePendingTransactions(state, 24 * 60 * 60 * 1000)).toBe(true);
      expect(state.history.find(entry => entry.id === 'old')?.status).toBe('not_included');
      expect(pendingTransactionRecoveries(state, 24 * 60 * 60 * 1000)).toEqual([
        expect.objectContaining({
          account,
          network: expect.objectContaining({ key: 'ethereum:mainnet' }),
          result: expect.objectContaining({ signature: '0xfresh', status: 'pending' }),
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
