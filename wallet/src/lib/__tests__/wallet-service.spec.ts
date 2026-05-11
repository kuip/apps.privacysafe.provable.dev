import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { WalletService } from '@/lib/wallet-service';
import { WALLET_STATE_PATH, WALLET_VAULT_PATH } from '@/lib/constants';
import { base64ToBytes, utf8Bytes } from '@/lib/format';
import { decryptVault } from '@/lib/vault-storage';
import { getMockStores, installMockW3nStorage } from '@/test/setup';
import {
  ALT_TEST_MNEMONIC,
  TEST_ETH_PRIVATE_KEY,
  TEST_MNEMONIC,
  TEST_PASSWORD,
  TEST_SOLANA_SEED_HEX,
  WRONG_PASSWORD,
} from '@/test/fixtures';

async function unlockedService(passphrase = TEST_PASSWORD): Promise<WalletService> {
  const service = new WalletService();
  await service.initialize();
  await service.unlock({ passphrase });
  return service;
}

describe('WalletService lifecycle with mocked storage', () => {
  it('requires at least 4 characters when creating a wallet password', async () => {
    const service = new WalletService();
    await service.initialize();

    await expect(service.unlock({ passphrase: '123' })).rejects.toThrow('Wallet password must be at least 4 characters.');
  });

  it('first unlock creates vault and state files', async () => {
    const service = await unlockedService();
    const raw = getMockStores().synced.dump();

    await expect(service.status()).resolves.toMatchObject({ exists: true, unlocked: true });
    expect(raw[WALLET_VAULT_PATH]).toBeTruthy();
    expect(raw[WALLET_STATE_PATH]).toBeTruthy();
  });

  it('reinitializes with an existing vault and unlocks with the correct password', async () => {
    await unlockedService();

    const next = new WalletService();
    await next.initialize();

    await expect(next.status()).resolves.toMatchObject({ exists: true, unlocked: false });
    await expect(next.unlock({ passphrase: TEST_PASSWORD })).resolves.toMatchObject({ version: 1 });
    await expect(next.status()).resolves.toMatchObject({ exists: true, unlocked: true });
  });

  it('fails with the wrong password', async () => {
    await unlockedService();
    const next = new WalletService();
    await next.initialize();

    await expect(next.unlock({ passphrase: WRONG_PASSWORD })).rejects.toThrow();
  });

  it('lock clears decrypted vault and blocks signing or transfer', async () => {
    const service = await unlockedService();
    const { state } = await service.createAccount({ name: 'Main' });
    const account = state.accounts.find(item => item.chain === 'ethereum')!;

    service.lock();

    await expect(service.signMessage({ accountId: account.id, message: 'hello' })).rejects.toThrow('Wallet is locked.');
    await expect(service.transfer({
      accountId: account.id,
      to: '0x0000000000000000000000000000000000000001',
      amount: '0.01',
      passphrase: TEST_PASSWORD,
    })).rejects.toThrow('Wallet is locked.');
  });
});

describe('create and import flows', () => {
  it('creates ETH and SOL accounts from a new seed group and increments nextAccountIndex', async () => {
    const service = await unlockedService();
    const first = await service.createAccount({ name: 'Main' });
    const firstChains = first.state.accounts.map(account => account.chain).sort();
    const second = await service.createAccount({ seedGroupId: first.seedGroupId, name: 'Second' });

    expect(first.mnemonic).toBeTruthy();
    expect(firstChains).toEqual(['ethereum', 'solana']);
    expect(first.accountIndex).toBe(0);
    expect(second.accountIndex).toBe(1);
    expect(second.state.accounts).toHaveLength(4);
    expect(second.state.seedGroups.find(group => group.id === first.seedGroupId)?.nextAccountIndex).toBe(2);
  });

  it('stores expected derivation paths for mnemonic accounts', async () => {
    const service = await unlockedService();
    const first = await service.createAccount({ name: 'Main' });
    const second = await service.createAccount({ seedGroupId: first.seedGroupId, name: 'Second' });

    expect(second.state.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chain: 'ethereum',
        accountIndex: 0,
        derivationPath: "m/44'/60'/0'/0/0",
      }),
      expect.objectContaining({
        chain: 'solana',
        accountIndex: 0,
        derivationPath: "m/44'/501'/0'/0'",
      }),
      expect.objectContaining({
        chain: 'ethereum',
        accountIndex: 1,
        derivationPath: "m/44'/60'/0'/0/1",
      }),
      expect.objectContaining({
        chain: 'solana',
        accountIndex: 1,
        derivationPath: "m/44'/501'/1'/0'",
      }),
    ]));
  });

  it('imports a mnemonic at the requested account index and advances the seed group index', async () => {
    const service = await unlockedService();
    const state = await service.importMnemonic({
      mnemonic: TEST_MNEMONIC,
      chains: ['ethereum', 'solana'],
      accountIndex: 3,
      name: 'Index three',
    });

    expect(state.seedGroups[0].nextAccountIndex).toBe(4);
    expect(state.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ chain: 'ethereum', accountIndex: 3, derivationPath: "m/44'/60'/0'/0/3" }),
      expect.objectContaining({ chain: 'solana', accountIndex: 3, derivationPath: "m/44'/501'/3'/0'" }),
    ]));
  });

  it('imports a mnemonic as a separate seed group', async () => {
    const service = await unlockedService();
    await service.createAccount({ name: 'Generated' });
    const state = await service.importMnemonic({
      mnemonic: ALT_TEST_MNEMONIC,
      chains: ['ethereum', 'solana'],
      name: 'Imported',
    });

    expect(state.seedGroups).toHaveLength(2);
    expect(state.accounts.filter(account => account.name === 'Imported')).toHaveLength(2);
  });

  it('imports a private key as a single account and stores the key only in the vault', async () => {
    const service = await unlockedService();
    const state = await service.importPrivateKey({
      chain: 'ethereum',
      privateKey: TEST_ETH_PRIVATE_KEY,
      name: 'Imported key',
    });
    const raw = getMockStores().synced.dump();
    const decrypted = await decryptVault(TEST_PASSWORD, raw[WALLET_VAULT_PATH] as Parameters<typeof decryptVault>[1]);

    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].secretKind).toBe('private-key');
    expect(state.accounts[0]).not.toHaveProperty('seedGroupId');
    expect(state.accounts[0]).not.toHaveProperty('accountIndex');
    expect(state.accounts[0]).not.toHaveProperty('derivationPath');
    expect(JSON.stringify(raw[WALLET_STATE_PATH])).not.toContain(TEST_ETH_PRIVATE_KEY);
    expect(Object.values(decrypted.secrets).some(secret => secret.privateKey === TEST_ETH_PRIVATE_KEY)).toBe(true);
  });

  it('imports a Solana seed as one account', async () => {
    const service = await unlockedService();
    const state = await service.importPrivateKey({
      chain: 'solana',
      privateKey: TEST_SOLANA_SEED_HEX,
      name: 'Solana seed',
    });

    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0]).toMatchObject({ chain: 'solana', secretKind: 'private-key' });
  });

  it('derives stable Ethereum and Solana addresses for the same mnemonic and index', async () => {
    const first = await unlockedService();
    const firstState = await first.importMnemonic({ mnemonic: TEST_MNEMONIC, chains: ['ethereum', 'solana'], name: 'Stable' });
    const firstAddresses = firstState.accounts.map(account => `${account.chain}:${account.address}`).sort();

    installMockW3nStorage();
    const second = await unlockedService();
    const secondState = await second.importMnemonic({ mnemonic: TEST_MNEMONIC, chains: ['ethereum', 'solana'], name: 'Stable' });
    const secondAddresses = secondState.accounts.map(account => `${account.chain}:${account.address}`).sort();

    expect(secondAddresses).toEqual(firstAddresses);
  });

  it('reset deletes both synced files', async () => {
    const service = await unlockedService();
    await service.createAccount({ name: 'Main' });

    await expect(service.resetVault({ passphrase: TEST_PASSWORD })).resolves.toMatchObject({ exists: false });
    expect(getMockStores().synced.dump()).toEqual({});
  });
});

describe('signing', () => {
  it('returns an Ethereum message signature recoverable to the account address', async () => {
    const service = await unlockedService();
    const { state } = await service.createAccount({ name: 'Main' });
    const account = state.accounts.find(item => item.chain === 'ethereum')!;
    const message = 'PrivacySafe wallet test';

    const result = await service.signMessage({ accountId: account.id, message });

    expect(ethers.verifyMessage(message, result.signature).toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('returns a Solana message signature that verifies with the public key', async () => {
    const service = await unlockedService();
    const { state } = await service.createAccount({ name: 'Main' });
    const account = state.accounts.find(item => item.chain === 'solana')!;
    const message = 'PrivacySafe wallet test';

    const result = await service.signMessage({ accountId: account.id, message });

    expect(nacl.sign.detached.verify(
      utf8Bytes(message),
      base64ToBytes(result.signature),
      new PublicKey(account.address).toBytes(),
    )).toBe(true);
  });

  it('enforces password-required message signing setting', async () => {
    const service = await unlockedService();
    const { state } = await service.createAccount({ name: 'Main' });
    const account = state.accounts.find(item => item.chain === 'ethereum')!;

    await service.updateSettings({ requirePasswordForMessageSigning: true });

    await expect(service.signMessage({ accountId: account.id, message: 'hello' }))
      .rejects.toThrow('Wallet password confirmation is required.');
    await expect(service.signMessage({ accountId: account.id, message: 'hello', passphrase: TEST_PASSWORD }))
      .resolves.toMatchObject({ accountId: account.id });
    await expect(service.signMessage({ accountId: account.id, message: 'hello', passphrase: WRONG_PASSWORD }))
      .rejects.toThrow();
  });

  it('enforces password-required transaction signing setting', async () => {
    const service = await unlockedService();
    const { state } = await service.createAccount({ name: 'Main' });
    const account = state.accounts.find(item => item.chain === 'ethereum')!;
    const transaction = {
      to: '0x0000000000000000000000000000000000000001',
      value: 1n,
      nonce: 0,
      gasLimit: 21000n,
      gasPrice: 1n,
      chainId: 1,
    };

    await expect(service.signTransaction({ accountId: account.id, transaction }))
      .rejects.toThrow('Wallet password confirmation is required.');
    await expect(service.signTransaction({ accountId: account.id, transaction, passphrase: TEST_PASSWORD }))
      .resolves.toMatchObject({ accountId: account.id, chain: 'ethereum', encoding: 'hex' });
  });
});

describe('password rules', () => {
  it('enforces password confirmation before transfers when configured', async () => {
    const service = await unlockedService();
    const { state } = await service.createAccount({ name: 'Main' });
    const account = state.accounts.find(item => item.chain === 'ethereum')!;

    await expect(service.transfer({
      accountId: account.id,
      to: '0x0000000000000000000000000000000000000001',
      amount: '0.01',
    })).rejects.toThrow('Wallet password confirmation is required.');
    await expect(service.transfer({
      accountId: account.id,
      to: '0x0000000000000000000000000000000000000001',
      amount: '0.01',
      passphrase: WRONG_PASSWORD,
    })).rejects.toThrow();
  });

  it('rejects too-short new wallet passwords', async () => {
    const service = await unlockedService();

    await expect(service.changePassphrase({
      currentPassphrase: TEST_PASSWORD,
      newPassphrase: '123',
    })).rejects.toThrow('New wallet password must be at least 4 characters.');
  });
});

describe('settings', () => {
  it('saves each setting immediately and persists it across service reinitialization', async () => {
    const service = await unlockedService();

    await service.updateSettings({
      requirePasswordForMessageSigning: true,
      enableDevelopmentNetworks: true,
    });

    const next = new WalletService();
    await next.initialize();
    const publicState = await next.getPublicState();

    expect(publicState.settings.requirePasswordForMessageSigning).toBe(true);
    expect(publicState.settings.enableDevelopmentNetworks).toBe(true);
  });
});
