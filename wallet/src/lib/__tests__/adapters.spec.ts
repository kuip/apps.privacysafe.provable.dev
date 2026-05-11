import { describe, expect, it } from 'vitest';
import { Transaction } from '@solana/web3.js';
import {
  type EthereumRpc,
  getEthereumNativeBalance,
  getEthereumTokenBalance,
} from '@/lib/ethereum-adapter';
import { type SolanaRpc, transferSolanaNative } from '@/lib/solana-adapter';
import { DEFAULT_NETWORKS, DEFAULT_TOKENS } from '@/lib/constants';
import { makeAccount, TEST_SOLANA_SEED_HEX } from '@/test/fixtures';
import type { NetworkConfig, ResolvedAccountSecret } from '@/lib/types';

describe('Ethereum RPC payloads', () => {
  it('requests native balance with eth_getBalance and latest block tag', async () => {
    const calls: Array<{ network: NetworkConfig; method: string; params: unknown[]; label: string }> = [];
    const rpc: EthereumRpc = async (network, method, params, label) => {
      calls.push({ network, method, params, label });
      return '0xde0b6b3a7640000' as never;
    };
    const account = makeAccount();

    const result = await getEthereumNativeBalance(rpc, account, DEFAULT_NETWORKS.ethereum as NetworkConfig);

    expect(result.formatted).toBe('1.0');
    expect(calls).toEqual([{
      network: DEFAULT_NETWORKS.ethereum as NetworkConfig,
      method: 'eth_getBalance',
      params: [account.address, 'latest'],
      label: 'native balance',
    }]);
  });

  it('requests ERC-20 balance with eth_call against the token contract', async () => {
    const calls: Array<{ network: NetworkConfig; method: string; params: unknown[]; label: string }> = [];
    const rpc: EthereumRpc = async (network, method, params, label) => {
      calls.push({ network, method, params, label });
      return '0x0000000000000000000000000000000000000000000000000000000000000005' as never;
    };
    const account = makeAccount();
    const token = DEFAULT_TOKENS.find(item => item.id === 'ethereum:mainnet:weth')!;

    const result = await getEthereumTokenBalance(rpc, account, DEFAULT_NETWORKS.ethereum as NetworkConfig, token);

    expect(result.raw).toBe('5');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('eth_call');
    expect(calls[0].params).toMatchObject([
      { to: token.address },
      'latest',
    ]);
    expect(String((calls[0].params as Array<{ data: string }>)[0].data)).toMatch(/^0x70a08231/);
  });
});

describe('Solana transfer payloads', () => {
  it('builds and broadcasts a native SOL transfer as a base64 transaction', async () => {
    const calls: Array<{ method: string; params: unknown[]; label: string }> = [];
    const rpc: SolanaRpc = async (_network, method: string, params: unknown[], label: string) => {
      calls.push({ method, params, label });
      if (method === 'getLatestBlockhash') {
        return {
          value: {
            blockhash: '11111111111111111111111111111111',
            lastValidBlockHeight: 1,
          },
        } as never;
      }
      return 'solana-signature' as never;
    };
    const account = makeAccount({
      id: 'solana:test',
      chain: 'solana',
      address: '4vJ9JU1bJJE96FWSJKRHSxpxFnq9WkKJzVsKqHoVZ7Ev',
      secretKind: 'private-key',
    });
    const secret: ResolvedAccountSecret = {
      chain: 'solana',
      kind: 'private-key',
      privateKey: TEST_SOLANA_SEED_HEX,
    };
    const to = '8qbHbw2BbbCr4kAqdwB5vfBDz3qS2YDRZ8Lc3pKfG6t';

    const result = await transferSolanaNative(rpc, secret, account, DEFAULT_NETWORKS.solanaDevnet as NetworkConfig, {
      accountId: account.id,
      to,
      amount: '0.25',
    });

    expect(result).toMatchObject({ signature: 'solana-signature', status: 'pending' });
    expect(calls.map(call => call.method)).toEqual(['getLatestBlockhash', 'sendTransaction']);
    expect(calls[1].label).toBe('transaction broadcast');
    expect(calls[1].params[1]).toMatchObject({
      encoding: 'base64',
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    const rawTx = Buffer.from(calls[1].params[0] as string, 'base64');
    const transaction = Transaction.from(rawTx);
    expect(transaction.instructions).toHaveLength(1);
    expect(transaction.instructions[0].programId.toBase58()).toBe('11111111111111111111111111111111');
    expect(transaction.instructions[0].keys[1].pubkey.toBase58()).toBe(to);
  });
});
