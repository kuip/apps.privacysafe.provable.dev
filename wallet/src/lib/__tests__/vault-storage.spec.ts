import { describe, expect, it } from 'vitest';
import {
  decryptVault,
  encryptVault,
  normalizePublicState,
  readWalletStores,
  writeWalletStores,
  deleteWalletStores,
} from '@/lib/vault-storage';
import { WALLET_STATE_PATH, WALLET_VAULT_PATH } from '@/lib/constants';
import { getMockStores } from '@/test/setup';
import {
  TEST_ETH_PRIVATE_KEY,
  TEST_MNEMONIC,
  TEST_PASSWORD,
  TEST_SOLANA_SEED_HEX,
  WRONG_PASSWORD,
  makeAccount,
  makePublicState,
  makeSecretVault,
} from '@/test/fixtures';
import type { VaultPlain, WalletPublicState } from '@/lib/types';

describe('vault encryption', () => {
  it('encrypts and decrypts with the correct password', async () => {
    const vault = makeSecretVault();
    const file = await encryptVault(TEST_PASSWORD, vault);

    await expect(decryptVault(TEST_PASSWORD, file)).resolves.toMatchObject({
      version: 1,
      seedGroups: vault.seedGroups,
      secrets: vault.secrets,
    });
  });

  it('rejects the wrong password', async () => {
    const file = await encryptVault(TEST_PASSWORD, makeSecretVault());

    await expect(decryptVault(WRONG_PASSWORD, file)).rejects.toThrow();
  });

  it('does not store mnemonic or private key plaintext in the vault file', async () => {
    const serialized = JSON.stringify(await encryptVault(TEST_PASSWORD, makeSecretVault()));

    expect(serialized).not.toContain(TEST_MNEMONIC);
    expect(serialized).not.toContain(TEST_SOLANA_SEED_HEX);
  });

  it('normalizes vault and state defaults', async () => {
    const partialVault = {
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as VaultPlain;
    const decrypted = await decryptVault(TEST_PASSWORD, await encryptVault(TEST_PASSWORD, partialVault));
    const publicState = normalizePublicState({
      version: 1,
      accounts: [],
      seedGroups: [],
      settings: { requirePasswordForTransfers: false },
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as WalletPublicState);

    expect(decrypted.seedGroups).toEqual({});
    expect(decrypted.secrets).toEqual({});
    expect(publicState?.networks.length).toBeGreaterThan(0);
    expect(publicState?.tokens.length).toBeGreaterThan(0);
    expect(publicState?.history).toEqual([]);
    expect(publicState?.settings.requirePasswordForTransfers).toBe(false);
    expect(publicState?.settings.requirePasswordForTransactionSigning).toBe(true);
  });
});

describe('wallet storage split', () => {
  it('stores secrets only in wallet-vault-v1.json and public state only in wallet-state-v1.json', async () => {
    const vaultFile = await encryptVault(TEST_PASSWORD, makeSecretVault());
    const publicState = makePublicState({
      accounts: [makeAccount()],
      history: [{
        id: 'tx-1',
        accountId: 'ethereum:0x8ba1f109551bd432803012645ac136ddd64dba72',
        chain: 'ethereum',
        networkKey: 'ethereum:mainnet',
        status: 'success',
        assetSymbol: 'ETH',
        amount: '1',
        to: '0x0000000000000000000000000000000000000001',
        signature: '0xabc',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    await writeWalletStores(vaultFile, publicState);

    const raw = getMockStores().synced.dump();
    const vaultJson = JSON.stringify(raw[WALLET_VAULT_PATH]);
    const stateJson = JSON.stringify(raw[WALLET_STATE_PATH]);

    expect(raw[WALLET_VAULT_PATH]).toBeTruthy();
    expect(raw[WALLET_STATE_PATH]).toBeTruthy();
    expect(vaultJson).not.toContain(TEST_MNEMONIC);
    expect(vaultJson).not.toContain(TEST_SOLANA_SEED_HEX);
    expect(stateJson).toContain('accounts');
    expect(stateJson).toContain('settings');
    expect(stateJson).toContain('history');
    expect(stateJson).not.toContain(TEST_MNEMONIC);
    expect(stateJson).not.toContain(TEST_ETH_PRIVATE_KEY);
    expect(stateJson).not.toContain(TEST_SOLANA_SEED_HEX);
  });

  it('reset deletes both wallet files', async () => {
    await writeWalletStores(await encryptVault(TEST_PASSWORD, makeSecretVault()), makePublicState());

    await deleteWalletStores();

    await expect(readWalletStores()).resolves.toEqual({
      vaultFile: undefined,
      publicState: undefined,
    });
  });
});
