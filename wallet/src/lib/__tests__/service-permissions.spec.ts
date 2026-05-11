import { describe, expect, it } from 'vitest';
import manifest from '../../../manifest.json';
import { EXTERNAL_WALLET_METHODS, INTERNAL_WALLET_METHODS } from '@/lib/service-permissions';

describe('service permission surface', () => {
  it('does not expose secret import, unlock, reset, or reveal methods to external apps', () => {
    expect(EXTERNAL_WALLET_METHODS).toEqual([
      'getPublicState',
      'listAccounts',
      'getBalance',
      'transfer',
      'signMessage',
      'signTransaction',
    ]);
    expect(EXTERNAL_WALLET_METHODS).not.toContain('unlock');
    expect(EXTERNAL_WALLET_METHODS).not.toContain('importMnemonic');
    expect(EXTERNAL_WALLET_METHODS).not.toContain('importPrivateKey');
    expect(EXTERNAL_WALLET_METHODS).not.toContain('revealRecoveryPhrase');
    expect(EXTERNAL_WALLET_METHODS).not.toContain('revealAccountPrivateKey');
    expect(EXTERNAL_WALLET_METHODS).not.toContain('resetVault');
    expect(INTERNAL_WALLET_METHODS).toEqual(expect.arrayContaining([
      'unlock',
      'importMnemonic',
      'importPrivateKey',
      'revealRecoveryPhrase',
      'revealAccountPrivateKey',
      'resetVault',
    ]));
  });

  it('keeps WalletInternal private and WalletSigner available to other apps', () => {
    const services = manifest.components['/walletDenoServices.js'].services;

    expect(services.WalletInternal).toEqual({ thisAppComponents: '*' });
    expect(services.WalletInternal).not.toHaveProperty('otherApps');
    expect(services.WalletSigner).toMatchObject({
      thisAppComponents: '*',
      otherApps: '*',
    });
  });
});
