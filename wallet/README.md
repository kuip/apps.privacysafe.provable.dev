# Wallet

Minimal wallet app for PrivacySafe.

V1 covers:
- Ethereum and Solana support on mainnet and configured testnets.
- Account creation from BIP-39 seed phrases, with seed groups deriving additional accounts by index.
- Account import by seed phrase or private key.
- Native coin balances and transfers.
- Preconfigured token balances and transfers: ERC-20 on Ethereum and SPL tokens on Solana.
- Message signing and raw transaction signing for wallet accounts.
- External PrivacySafe app requests through `WalletSigner`, with wallet approval UI prompts for user confirmation, for transfers, message signing, and transaction signing.
- Wallet-scoped transfer history for transactions submitted by this wallet, including pending, confirmed, failed, and not-included status.
- Password-protected reveal/export of recovery phrases and imported private keys.
- Wallet-level encryption for seed phrases and private keys, stored inside PrivacySafe synced storage.
- Wallet lock and unlock with a wallet password.
- Settings for requiring wallet password confirmation before transfers, message signing, and transaction signing.

## Dependency Lock Policy

```bash
npm ci --ignore-scripts
npm run build
npm run test
```

Build the wallet into this repository's standalone PrivacySafe app bundle:

```bash
cd ..
make build-wallet
```

The staged app is written to `build/apps/dev.provable.app.wallet`.

## Storage Mode

The wallet follows the PrivacySafe Treasure app storage model and uses app synced FS for wallet data. It writes:
- `wallet-vault-v1.json`: wallet-password encrypted secret vault containing seed phrases and imported private keys.
- `wallet-state-v1.json`: PrivacySafe-synced wallet state containing accounts, public seed group metadata, settings, and history.

The wallet vault is encrypted by the wallet password before it is written to PrivacySafe synced storage, hence it has an additional encryption layer compared to PrivacySafe apps, so that the user can lock the wallet while having other apps open. Locking the wallet also prevents other PrivacySafe apps from calling the Wallet API  (the user will be prompted to unlock).

## RPC Endpoint Policy

The wallet keeps the default RPC allowlist intentionally small:

- Ethereum mainnet, Sepolia, and Hoodi: PublicNode endpoints.
- Solana mainnet: PublicNode endpoint.
- Solana devnet: Solana Labs public devnet endpoint.

These public endpoints are for the minimal default wallet. Production deployments should prefer dedicated/private RPC endpoints or a PrivacySafe-operated RPC relay, especially for Solana where public endpoints are rate-limited and may reject high-traffic clients.

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

- `transfer({ accountId, to, amount, tokenId? })`
  Sends native ETH/SOL or a tracked ERC-20/SPL token transfer.

- `signMessage({ accountId, message })`
  Signs a message with the selected account.

- `signTransaction({ accountId, transaction, encoding? })`
  Signs a transaction with the selected account. Ethereum expects an ethers transaction request object. Solana expects a base64 serialized transaction and returns a base64 signed transaction.

The external service does not expose mnemonic or private-key import methods.

## Internal Service

`WalletInternal` is private to the wallet app. It includes the external methods above plus wallet-management methods used by the UI:

- `status()`
- `unlock({ passphrase })`
- `lock()`
- `updateSettings(settings)`
- `changePassphrase({ currentPassphrase, newPassphrase })`
- `resetVault({ passphrase })`
- `createAccount({ seedGroupId?, chains?, name?, walletName? })`
- `importMnemonic({ mnemonic, chains, accountIndex?, name?, walletName? })`
- `importPrivateKey({ chain, privateKey, name? })`
- `revealRecoveryPhrase({ accountId, passphrase })`
- `revealAccountPrivateKey({ accountId, passphrase })`

Only the wallet UI can call `WalletInternal`. Other PrivacySafe apps must use `WalletSigner`.

## External Signing Approval

External `WalletSigner` requests are routed through the wallet UI. For transfer, message signing, and transaction signing, the wallet opens an approval prompt, shows the requested action details, and asks the user to approve or reject the request. When the wallet settings require password confirmation, the wallet prompts for the password inside the wallet UI.

External apps should never send wallet passwords. If an external request includes a `passphrase` field, the wallet UI strips it before forwarding the approved request to the private internal wallet service.

Current limitation: the approval prompt shows the requester as "External PrivacySafe app". Production should replace this with the actual caller (app) identity once PrivacySafe exposes it to the service handler.

## Security

This wallet app relies on PrivacySafe encryption and security model. Like the Treasure app, it uses the synced storage model `getAppSyncedFS()` from the Storage app. The wallet does not depend on Android Keystore or biometric APIs; those are platform implementation details and are not exposed to PrivacySafe apps.

However, this Wallet app uses its own additional encryption for private keys and seed phrases.
* AES-GCM. The key is derived from the wallet password with scrypt: N=32768, r=8, p=1, dkLen=32, random 16-byte salt, random 12-byte IV.

2 files are produced:
* wallet-vault-v1.json:
    - wallet-password encrypted
    - contains secret material only: seed phrases, imported private keys, and secret derivation metadata
* wallet-state-v1.json
    - not wallet-password encrypted
    - contains non-secret wallet state: account addresses, public seed group metadata, settings, and history

### Security Notes

The wallet-level encryption envelope is intentionally independent from PrivacySafe storage encryption. PrivacySafe already protects the synced storage layer; the wallet password adds an app-level barrier around seed phrases and imported private keys.

Current parameters are acceptable for this v1 wallet: scrypt with `N=32768`, `r=8`, `p=1` uses roughly 32 MiB of memory and derives a 256-bit AES-GCM key. This is a reasonable cross-platform default for desktop and mobile web runtimes.

Known security assumptions and remaining hardening items:

- The wallet password is kept in memory only while the wallet is unlocked so the vault can be re-encrypted after writes. Locking clears the service references, but JavaScript strings cannot be reliably zeroized.
- Decrypted seed phrases and private keys live in JavaScript memory while unlocked and while signing. This is acceptable under the PrivacySafe app isolation model.
- Revealed secrets and copied values are intentionally shown only after wallet password confirmation. Clipboard lifetime is controlled by the host platform, not the wallet.
- Logs should never include seed phrases, private keys, or wallet passwords. Errors should continue to be reviewed when new code paths are added.
- Password policy is currently minimal: at least 4 characters. Production may choose to call it a PIN and keep this policy, or require a stronger wallet password if offline vault extraction is in scope.

## Known Limitations

- External approval currently identifies the caller as "External PrivacySafe app". It should show the real caller app identity once PrivacySafe exposes that metadata to service handlers.
- Raw transaction signing approval displays request details, but full chain-specific transaction decoding is limited. Production should decode high-risk fields such as recipient, value, token approvals, program instructions, chain id, and fees.
- RPC endpoints are public defaults. Production should use dedicated endpoints or a PrivacySafe-operated relay for higher reliability and better privacy.
- History is wallet-local state for transfers submitted through this wallet service. It is not a full chain indexer and does not discover inbound transfers or transactions sent by other wallets.
- Pending transaction recovery is bounded and best-effort. Very old pending entries are marked not included instead of polling forever.
- Wallet password encrypted vault data is stored in PrivacySafe synced storage. If synced storage is reset or deleted, the wallet cannot recover data unless the user has backed up the recovery phrase/private key.
