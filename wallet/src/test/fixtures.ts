import { DEFAULT_NETWORK_LIST, DEFAULT_TOKENS } from '@/lib/constants';
import { DEFAULT_WALLET_SETTINGS, makeEmptyPublicState, makeEmptyVault } from '@/lib/vault-storage';
import type { SeedGroupSecret, VaultPlain, WalletAccount, WalletPublicState } from '@/lib/types';

export const TEST_PASSWORD = '1234';
export const WRONG_PASSWORD = '9999';
export const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const ALT_TEST_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
export const TEST_ETH_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const TEST_SOLANA_SEED_HEX = '0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

export function makeSecretVault(): VaultPlain {
  const vault = makeEmptyVault();
  const seedGroup: SeedGroupSecret = {
    id: 'seed:test',
    name: 'Test wallet',
    mnemonic: TEST_MNEMONIC,
    nextAccountIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  vault.seedGroups[seedGroup.id] = seedGroup;
  vault.secrets['ethereum:0xabc'] = {
    chain: 'ethereum',
    kind: 'mnemonic',
    seedGroupId: seedGroup.id,
    accountIndex: 0,
    derivationPath: "m/44'/60'/0'/0/0",
  };
  vault.secrets['solana:abc'] = {
    chain: 'solana',
    kind: 'private-key',
    privateKey: TEST_SOLANA_SEED_HEX,
  };
  return vault;
}

export function makePublicState(overrides: Partial<WalletPublicState> = {}): WalletPublicState {
  return {
    ...makeEmptyPublicState(),
    networks: [...DEFAULT_NETWORK_LIST],
    tokens: [...DEFAULT_TOKENS],
    accounts: [],
    seedGroups: [],
    history: [],
    settings: { ...DEFAULT_WALLET_SETTINGS },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<WalletAccount> = {}): WalletAccount {
  return {
    id: 'ethereum:0x8ba1f109551bd432803012645ac136ddd64dba72',
    chain: 'ethereum',
    name: 'Main account',
    address: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    secretKind: 'mnemonic',
    seedGroupId: 'seed:test',
    accountIndex: 0,
    derivationPath: "m/44'/60'/0'/0/0",
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
