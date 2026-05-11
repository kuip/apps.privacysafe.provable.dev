# Wallet

Minimal PrivacySafe wallet app for Ethereum and Solana.

The wallet can create accounts from BIP-39 recovery phrases, import existing recovery phrases as separate seed-backed wallets, import a 32-byte Ethereum private key or Solana seed, show native and tracked token balances, send transfers, sign messages, and sign transactions. Private keys and recovery phrases stay inside this app's encrypted wallet vault.

V1 covers:

- Ethereum and Solana support on mainnet and configured testnets.
- Account creation from seed-backed wallets, with each new account deriving the next account index.
- Account import by recovery phrase or private key.
- Native coin transfers and preconfigured token transfers: ERC-20 on Ethereum and SPL tokens on Solana.
- Local history for transfers submitted by this wallet, including pending and confirmed transaction status.
- Wallet-level encryption for recovery phrases and private keys, stored inside PrivacySafe encrypted storage.
- Wallet lock and unlock with a wallet password.

## Seed-Backed Wallets

The vault stores recovery phrases as seed groups. A seed group has public metadata, such as name and next account index, and private encrypted seed material. Accounts derived from a seed group store only the seed group id, account index, chain, derivation path, and public address.

Creating a new account uses the selected seed group and increments its account index. If no seed group is selected, the wallet creates a new BIP-39 recovery phrase and stores it as a new seed group. Importing a recovery phrase creates a separate seed group, so the wallet can hold multiple independent seed-backed wallets.

For backup, a seed-backed account can reveal both the base recovery phrase and the derived account private key after wallet password confirmation. A private-key import can reveal only its imported private key.

The app has two RPC services:

- `WalletInternal`: used only by wallet UI components.
- `WalletSigner`: callable by other PrivacySafe apps.

## External Service

`WalletSigner` exposes these methods to other apps:

- `getPublicState()`
  Returns public wallet state: accounts, networks, tracked tokens, history, settings, and update timestamp. It does not return secrets.

- `listAccounts()`
  Returns the wallet accounts visible in public state.

- `getBalance({ accountId, tokenId? })`
  Returns native balance for the account, or token balance when `tokenId` is provided.

- `transfer({ accountId, to, amount, tokenId?, passphrase? })`
  Sends native ETH/SOL or a tracked ERC-20/SPL token transfer.

- `signMessage({ accountId, message, passphrase? })`
  Signs a message with the selected account.

- `signTransaction({ accountId, transaction, encoding?, passphrase? })`
  Signs a transaction with the selected account. Ethereum expects an ethers transaction request object. Solana expects a base64 serialized transaction and returns a base64 signed transaction.

The external service does not expose mnemonic or private-key import methods.

## External Signing Approval

Current behavior: external `WalletSigner` requests are handled by the hidden service component. The wallet does not yet open a user approval dialog, does not show which app is requesting the signature, and does not prompt for the wallet password on behalf of that app.

If the wallet setting requires password confirmation for transaction signing, `signTransaction` requires `passphrase` in the RPC request. External apps should not have the wallet password, so this mode effectively blocks external transaction signing until a proper wallet approval flow is added.

Before external transaction signing is production-ready, the wallet should add an approval UI that shows the requesting app, account, network, transaction details, and asks the user to approve or reject with wallet password confirmation when required.
