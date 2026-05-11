export const INTERNAL_WALLET_METHODS = [
  'status',
  'createAccount',
  'unlock',
  'lock',
  'getPublicState',
  'listAccounts',
  'updateSettings',
  'changePassphrase',
  'resetVault',
  'revealRecoveryPhrase',
  'revealAccountPrivateKey',
  'importMnemonic',
  'importPrivateKey',
  'getBalance',
  'transfer',
  'signMessage',
  'signTransaction',
] as const;

export const EXTERNAL_WALLET_METHODS = [
  'getPublicState',
  'listAccounts',
  'getBalance',
  'transfer',
  'signMessage',
  'signTransaction',
] as const;
