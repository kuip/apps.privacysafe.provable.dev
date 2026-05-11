import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { DEFAULT_NETWORK_LIST, DEFAULT_NETWORKS, DEFAULT_TOKENS } from '@/lib/constants';
import { bytesToBase64, randomBytes } from '@/lib/format';
import {
  ethereumWalletFromSecret,
  getEthereumNativeBalance,
  getEthereumTokenBalance,
  signEthereumMessage,
  signEthereumTransaction,
  transferEthereumNative,
  transferEthereumToken,
  waitForEthereumConfirmation,
} from '@/lib/ethereum-adapter';
import {
  getSolanaNativeBalance,
  getSolanaTokenBalance,
  signSolanaMessage,
  signSolanaTransaction,
  solanaKeypairFromSecret,
  solanaPrivateKeyFromSecret,
  transferSolanaNative,
  transferSolanaToken,
  waitForSolanaConfirmation,
} from '@/lib/solana-adapter';
import {
  addTransactionHistoryEntry,
  makeTransactionHistoryEntry,
  markStalePendingTransactions,
  pendingTransactionRecoveries,
  updatePendingTransaction,
} from '@/lib/history-manager';
import { jsonRpcWithFallback, rpcUserMessage } from '@/lib/rpc-client';
import {
  DEFAULT_WALLET_SETTINGS,
  decryptVault,
  deleteWalletStores,
  encryptVault,
  makeEmptyVault,
  normalizePublicState,
  publicStateFromVault,
  readWalletStores,
  writeWalletStores,
  type WalletVaultFile,
} from '@/lib/vault-storage';
import type {
  AccountSecret,
  BalanceRequest,
  BalanceResult,
  ChangePassphraseRequest,
  Chain,
  CreateAccountRequest,
  CreateAccountResult,
  ImportMnemonicRequest,
  ImportPrivateKeyRequest,
  NetworkConfig,
  ResetVaultRequest,
  ResolvedAccountSecret,
  RevealAccountPrivateKeyRequest,
  RevealAccountPrivateKeyResult,
  RevealRecoveryPhraseRequest,
  RevealRecoveryPhraseResult,
  SeedGroupSecret,
  SignMessageRequest,
  SignMessageResult,
  SignTransactionRequest,
  SignTransactionResult,
  TokenConfig,
  TransferRequest,
  TransferResult,
  UnlockRequest,
  VaultPlain,
  WalletAccount,
  WalletPublicState,
  WalletSettings,
  WalletStatus,
} from '@/lib/types';

const RPC_REQUEST_TIMEOUT_MS = 12000;
const TX_CONFIRM_TIMEOUT_MS = 120000;
const PENDING_TX_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function accountId(chain: Chain, address: string): string {
  return `${chain}:${address}`;
}

function newSeedGroupId(): string {
  return `seed:${bytesToBase64(randomBytes(12)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`;
}

function derivationPath(chain: Chain, accountIndex: number): string {
  return chain === 'ethereum'
    ? `m/44'/60'/0'/0/${accountIndex}`
    : `m/44'/501'/${accountIndex}'/0'`;
}

function assertUnlocked(vault: VaultPlain | undefined): asserts vault is VaultPlain {
  if (!vault) {
    throw new Error('Wallet is locked.');
  }
}

export class WalletService {
  private vault?: VaultPlain;
  private passphrase?: string;
  private vaultFile?: WalletVaultFile;
  private publicState?: WalletPublicState;

  async initialize(): Promise<void> {
    const stores = await readWalletStores();
    this.vaultFile = stores.vaultFile;
    this.publicState = stores.publicState;
  }

  async status(): Promise<WalletStatus> {
    if (!this.vaultFile && !this.publicState) {
      await this.initialize();
    }

    return {
      exists: !!this.vaultFile,
      unlocked: !!this.vault,
      accountCount: this.vault?.accounts.length ?? this.publicState?.accounts.length ?? 0,
      updatedAt: this.vault?.updatedAt ?? this.publicState?.updatedAt ?? this.vaultFile?.updatedAt,
    };
  }

  async unlock(request: UnlockRequest): Promise<WalletPublicState> {
    if (!this.vaultFile) {
      await this.initialize();
    }
    if (!this.vaultFile) {
      if (request.passphrase.length < 4) {
        throw new Error('Wallet password must be at least 4 characters.');
      }
      this.vault = makeEmptyVault();
      this.passphrase = request.passphrase;
      await this.persist();
      return publicStateFromVault(this.vault);
    }

    this.vault = await decryptVault(request.passphrase, this.vaultFile);
    this.passphrase = request.passphrase;
    this.publicState = publicStateFromVault(this.vault);
    this.recoverPendingTransactions();
    return this.publicState;
  }

  lock(): WalletStatus {
    this.vault = undefined;
    this.passphrase = undefined;
    return {
      exists: !!this.vaultFile,
      unlocked: false,
      accountCount: this.publicState?.accounts.length ?? 0,
      updatedAt: this.publicState?.updatedAt ?? this.vaultFile?.updatedAt,
    };
  }

  async getPublicState(): Promise<WalletPublicState> {
    if (this.vault) {
      return publicStateFromVault(this.vault);
    }
    if (!this.publicState) {
      await this.initialize();
    }
    return normalizePublicState(this.publicState) ?? {
      version: 1,
      accounts: [],
      seedGroups: [],
      networks: [...DEFAULT_NETWORK_LIST] as NetworkConfig[],
      tokens: [...DEFAULT_TOKENS] as TokenConfig[],
      history: [],
      settings: { ...DEFAULT_WALLET_SETTINGS },
      updatedAt: nowIso(),
    };
  }

  async updateSettings(settings: Partial<WalletSettings>): Promise<WalletPublicState> {
    assertUnlocked(this.vault);
    this.vault.settings = {
      ...DEFAULT_WALLET_SETTINGS,
      ...this.vault.settings,
      ...settings,
    };
    await this.persist();
    return publicStateFromVault(this.vault);
  }

  async changePassphrase(request: ChangePassphraseRequest): Promise<WalletStatus> {
    if (!request.newPassphrase) {
      throw new Error('New wallet password is required.');
    }
    if (request.newPassphrase.length < 4) {
      throw new Error('New wallet password must be at least 4 characters.');
    }
    if (!this.vaultFile) {
      await this.initialize();
    }
    if (!this.vaultFile) {
      throw new Error('Wallet vault file is not loaded.');
    }
    this.vault = await decryptVault(request.currentPassphrase, this.vaultFile);
    this.passphrase = request.newPassphrase;
    await this.persist();
    return this.status();
  }

  async resetVault(request: ResetVaultRequest): Promise<WalletStatus> {
    if (!this.vaultFile) {
      await this.initialize();
    }
    if (this.vaultFile) {
      await decryptVault(request.passphrase, this.vaultFile);
    }
    await deleteWalletStores();

    this.vault = undefined;
    this.passphrase = undefined;
    this.vaultFile = undefined;
    this.publicState = undefined;
    return {
      exists: false,
      unlocked: false,
      accountCount: 0,
    };
  }

  async revealRecoveryPhrase(request: RevealRecoveryPhraseRequest): Promise<RevealRecoveryPhraseResult> {
    assertUnlocked(this.vault);
    await this.confirmPassphrase(request.passphrase);
    const account = await this.getAccount(request.accountId);
    const secret = this.accountSecret(account.id);
    if (secret.kind === 'mnemonic' && secret.mnemonic) {
      return {
        accountId: account.id,
        mnemonic: secret.mnemonic,
        derivationPath: secret.derivationPath,
      };
    }
    throw new Error('This account is not backed by a recovery phrase.');
  }

  async revealAccountPrivateKey(request: RevealAccountPrivateKeyRequest): Promise<RevealAccountPrivateKeyResult> {
    assertUnlocked(this.vault);
    await this.confirmPassphrase(request.passphrase);
    const account = await this.getAccount(request.accountId);
    const secret = this.accountSecret(account.id);
    return {
      accountId: account.id,
      chain: account.chain,
      privateKey: account.chain === 'ethereum'
        ? ethereumWalletFromSecret(secret).privateKey
        : solanaPrivateKeyFromSecret(secret),
    };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    const state = await this.getPublicState();
    return state.accounts;
  }

  async createAccount(request: CreateAccountRequest): Promise<CreateAccountResult> {
    assertUnlocked(this.vault);
    const chains = request.chains ?? (['ethereum', 'solana'] satisfies Chain[]);
    let group = request.seedGroupId ? this.vault.seedGroups[request.seedGroupId] : undefined;
    let mnemonic: string | undefined;
    const timestamp = nowIso();

    if (!group) {
      mnemonic = generateMnemonic(wordlist, 128);
      group = {
        id: newSeedGroupId(),
        name: request.walletName || `Wallet ${Object.keys(this.vault.seedGroups).length + 1}`,
        mnemonic,
        nextAccountIndex: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.vault.seedGroups[group.id] = group;
    }

    const accountIndex = group.nextAccountIndex;
    this.addSeedGroupAccounts(group, accountIndex, chains, request.name);
    group.nextAccountIndex = accountIndex + 1;
    group.updatedAt = timestamp;
    await this.persist();
    return {
      state: publicStateFromVault(this.vault),
      seedGroupId: group.id,
      accountIndex,
      mnemonic,
    };
  }

  async importMnemonic(request: ImportMnemonicRequest): Promise<WalletPublicState> {
    if (request.passphrase && !this.vault) {
      await this.unlock({ passphrase: request.passphrase });
    }
    assertUnlocked(this.vault);

    const mnemonic = request.mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('Mnemonic is not valid BIP-39.');
    }

    const index = request.accountIndex ?? 0;
    const timestamp = nowIso();
    const group: SeedGroupSecret = {
      id: newSeedGroupId(),
      name: request.walletName || request.name || `Wallet ${Object.keys(this.vault.seedGroups).length + 1}`,
      mnemonic,
      nextAccountIndex: index,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.vault.seedGroups[group.id] = group;
    const added = this.addSeedGroupAccounts(group, index, request.chains, request.name);
    group.nextAccountIndex = Math.max(group.nextAccountIndex, index + 1);
    group.updatedAt = timestamp;

    if (added.length === 0) {
      throw new Error('No chains selected for mnemonic import.');
    }

    await this.persist();
    return publicStateFromVault(this.vault);
  }

  async importPrivateKey(request: ImportPrivateKeyRequest): Promise<WalletPublicState> {
    if (request.passphrase && !this.vault) {
      await this.unlock({ passphrase: request.passphrase });
    }
    assertUnlocked(this.vault);

    const secret: AccountSecret = {
      chain: request.chain,
      kind: 'private-key',
      privateKey: request.privateKey.trim(),
    };
    const address = request.chain === 'ethereum'
      ? ethereumWalletFromSecret(secret).address
      : solanaKeypairFromSecret(secret).publicKey.toBase58();
    const account: WalletAccount = {
      id: accountId(request.chain, address),
      chain: request.chain,
      name: request.name || `${request.chain === 'ethereum' ? 'Ethereum' : 'Solana'} imported`,
      address,
      secretKind: 'private-key',
      createdAt: nowIso(),
    };

    this.upsertAccount(account, secret);
    await this.persist();
    return publicStateFromVault(this.vault);
  }

  async getBalance(request: BalanceRequest): Promise<BalanceResult> {
    const account = await this.getAccount(request.accountId);
    const network = await this.getNetwork(request.networkKey, account.chain);
    try {
      if (request.tokenId) {
        const token = await this.getTokenForAccount(request.tokenId, account, network);
        return account.chain === 'ethereum'
          ? getEthereumTokenBalance(this.ethereumRpc.bind(this), account, network, token)
          : getSolanaTokenBalance(this.solanaRpc.bind(this), account, network, token);
      }

      return account.chain === 'ethereum'
        ? getEthereumNativeBalance(this.ethereumRpc.bind(this), account, network)
        : getSolanaNativeBalance(this.solanaRpc.bind(this), account, network);
    } catch (err) {
      const message = rpcUserMessage(err);
      if (message) {
        throw new Error(message);
      }
      throw err;
    }
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    await this.confirmIfRequired('transfer', request.passphrase);
    const account = await this.getAccount(request.accountId);
    const network = await this.getNetwork(request.networkKey, account.chain);
    const secret = this.accountSecret(account.id);

    try {
      const result = request.tokenId
        ? await this.transferToken(secret, account, network, request)
        : await this.transferNative(secret, account, network, request);
      const assetSymbol = request.tokenId
        ? (await this.getTokenForAccount(request.tokenId, account, network)).symbol
        : network.nativeSymbol;

      await this.tryRecordTransaction(account, network, request, result, assetSymbol);
      this.refreshTransactionHistoryStatus(account, network, result);
      return result;
    } catch (err) {
      const message = rpcUserMessage(err);
      if (message) {
        throw new Error(message);
      }
      throw err;
    }
  }

  async signMessage(request: SignMessageRequest): Promise<SignMessageResult> {
    assertUnlocked(this.vault);
    await this.confirmIfRequired('message-signing', request.passphrase);
    const account = await this.getAccount(request.accountId);
    const secret = this.accountSecret(account.id);

    return {
      accountId: account.id,
      chain: account.chain,
      address: account.address,
      signature: account.chain === 'ethereum'
        ? await signEthereumMessage(secret, request.message)
        : await signSolanaMessage(secret, request.message),
    };
  }

  async signTransaction(request: SignTransactionRequest): Promise<SignTransactionResult> {
    assertUnlocked(this.vault);
    await this.confirmIfRequired('transaction-signing', request.passphrase);
    const account = await this.getAccount(request.accountId);
    const secret = this.accountSecret(account.id);

    if (account.chain === 'ethereum') {
      return {
        accountId: account.id,
        chain: account.chain,
        signedTransaction: await signEthereumTransaction(secret, request.transaction),
        encoding: 'hex',
      };
    }

    if (request.encoding !== 'base64' || typeof request.transaction !== 'string') {
      throw new Error('Solana signTransaction expects a base64 serialized transaction.');
    }
    return {
      accountId: account.id,
      chain: account.chain,
      signedTransaction: signSolanaTransaction(secret, request.transaction),
      encoding: 'base64',
    };
  }

  private upsertAccount(account: WalletAccount, secret: AccountSecret): void {
    assertUnlocked(this.vault);
    const idx = this.vault.accounts.findIndex(item => item.id === account.id);
    if (idx >= 0) {
      this.vault.accounts[idx] = account;
    } else {
      this.vault.accounts.push(account);
    }
    this.vault.secrets[account.id] = secret;
    this.vault.updatedAt = nowIso();
  }

  private async persist(): Promise<void> {
    assertUnlocked(this.vault);
    if (!this.passphrase) {
      throw new Error('Wallet passphrase is not available.');
    }

    this.vault.updatedAt = nowIso();
    this.vaultFile = await encryptVault(this.passphrase, this.vault);
    this.publicState = publicStateFromVault(this.vault);
    await writeWalletStores(this.vaultFile, this.publicState);
  }

  private async confirmPassphrase(passphrase: string | undefined): Promise<void> {
    if (!passphrase) {
      throw new Error('Wallet password confirmation is required.');
    }
    if (!this.vaultFile) {
      throw new Error('Wallet vault file is not loaded.');
    }
    await decryptVault(passphrase, this.vaultFile);
  }

  private async confirmIfRequired(
    operation: 'transfer' | 'message-signing' | 'transaction-signing',
    passphrase: string | undefined,
  ): Promise<void> {
    assertUnlocked(this.vault);
    const settings = {
      ...DEFAULT_WALLET_SETTINGS,
      ...this.vault.settings,
    };
    const required = operation === 'transfer'
      ? settings.requirePasswordForTransfers
      : operation === 'message-signing'
        ? settings.requirePasswordForMessageSigning
        : settings.requirePasswordForTransactionSigning;

    if (required) {
      await this.confirmPassphrase(passphrase);
    }
  }

  private async tryRecordTransaction(
    account: WalletAccount,
    network: NetworkConfig,
    request: TransferRequest,
    result: TransferResult,
    assetSymbol: string,
  ): Promise<void> {
    try {
      assertUnlocked(this.vault);
      addTransactionHistoryEntry(this.vault, makeTransactionHistoryEntry(account, network, request, result, assetSymbol));
      await this.persist();
    } catch (err) {
      await w3n.log?.('error', 'Wallet failed to record transaction history', err);
    }
  }

  private accountSecret(accountIdToFind: string): ResolvedAccountSecret {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[accountIdToFind];
    if (!secret) {
      throw new Error('No secret found for account.');
    }
    if (secret.kind !== 'mnemonic') {
      return secret;
    }
    const group = secret.seedGroupId ? this.vault.seedGroups[secret.seedGroupId] : undefined;
    if (!group) {
      throw new Error('Seed group not found for account.');
    }
    return {
      ...secret,
      mnemonic: group.mnemonic,
    };
  }

  private addSeedGroupAccounts(
    group: SeedGroupSecret,
    accountIndex: number,
    chains: Chain[],
    name: string | undefined,
  ): WalletAccount[] {
    assertUnlocked(this.vault);
    const added: WalletAccount[] = [];
    for (const chain of chains) {
      const path = derivationPath(chain, accountIndex);
      const secretForDerivation: AccountSecret = {
        chain,
        kind: 'mnemonic',
        seedGroupId: group.id,
        accountIndex,
        derivationPath: path,
      };
      const address = chain === 'ethereum'
        ? ethereumWalletFromSecret({ ...secretForDerivation, mnemonic: group.mnemonic }).address
        : solanaKeypairFromSecret({ ...secretForDerivation, mnemonic: group.mnemonic }).publicKey.toBase58();
      const account: WalletAccount = {
        id: accountId(chain, address),
        chain,
        name: name || `${group.name} ${accountIndex + 1}`,
        address,
        seedGroupId: group.id,
        accountIndex,
        derivationPath: path,
        secretKind: 'mnemonic',
        createdAt: nowIso(),
      };
      this.upsertAccount(account, secretForDerivation);
      added.push(account);
    }
    return added;
  }

  private refreshTransactionHistoryStatus(
    account: WalletAccount,
    network: NetworkConfig,
    result: TransferResult,
  ): void {
    if (result.status !== 'pending') {
      return;
    }

    void (async () => {
      const confirmation = account.chain === 'ethereum'
        ? await waitForEthereumConfirmation(this.ethereumRpc.bind(this), network, result.signature, TX_CONFIRM_TIMEOUT_MS)
        : await waitForSolanaConfirmation(this.solanaRpc.bind(this), network, result.signature, TX_CONFIRM_TIMEOUT_MS);
      if (!this.vault || confirmation.status === 'pending') {
        return;
      }
      if (updatePendingTransaction(this.vault, account, network, result, confirmation)) {
        await this.persist();
      }
    })().catch(err => {
      void w3n.log?.('error', `Wallet failed to refresh transaction status ${result.signature}`, err);
    });
  }

  private recoverPendingTransactions(): void {
    if (!this.vault) {
      return;
    }
    const markedStale = markStalePendingTransactions(this.vault, PENDING_TX_RECOVERY_MAX_AGE_MS);
    for (const recovery of pendingTransactionRecoveries(this.vault, PENDING_TX_RECOVERY_MAX_AGE_MS)) {
      this.refreshTransactionHistoryStatus(recovery.account, recovery.network, recovery.result);
    }
    if (markedStale) {
      void this.persist().catch(err => {
        void w3n.log?.('error', 'Wallet failed to persist stale pending transaction recovery', err);
      });
    }
  }

  private async getAccount(accountIdToFind: string): Promise<WalletAccount> {
    const accounts = this.vault?.accounts ?? (await this.getPublicState()).accounts;
    const account = accounts.find(item => item.id === accountIdToFind);
    if (!account) {
      throw new Error(`Account not found: ${accountIdToFind}`);
    }
    return account;
  }

  private async getToken(tokenId: string): Promise<TokenConfig> {
    const state = await this.getPublicState();
    const token = state.tokens.find(item => item.id === tokenId);
    if (!token) {
      throw new Error(`Token not found: ${tokenId}`);
    }
    return token;
  }

  private async getTokenForAccount(tokenId: string, account: WalletAccount, network: NetworkConfig): Promise<TokenConfig> {
    const token = await this.getToken(tokenId);
    if (token.chain !== account.chain) {
      throw new Error('Token chain does not match account chain.');
    }
    if (token.networkKey !== network.key) {
      throw new Error('Token network does not match selected network.');
    }
    return token;
  }

  private async getNetwork(networkKey: string | undefined, chain: Chain): Promise<NetworkConfig> {
    const state = await this.getPublicState();
    const fallback = chain === 'ethereum' ? DEFAULT_NETWORKS.ethereum : DEFAULT_NETWORKS.solana;
    const network = state.networks.find(item => item.key === (networkKey ?? fallback.key)) ?? fallback;
    if (network.chain !== chain) {
      throw new Error('Selected network does not match account chain.');
    }
    return network as NetworkConfig;
  }

  private rpcUrls(network: NetworkConfig): string[] {
    return Array.from(new Set([
      network.rpcUrl,
      ...(network.rpcUrls ?? []),
    ]));
  }

  private async ethereumRpc<T>(
    network: NetworkConfig,
    method: string,
    params: unknown[],
    label: string,
  ): Promise<T> {
    return this.rpc('ethereum', network, method, params, label);
  }

  private async solanaRpc<T>(
    network: NetworkConfig,
    method: string,
    params: unknown[],
    label: string,
  ): Promise<T> {
    return this.rpc('solana', network, method, params, label);
  }

  private async rpc<T>(
    chain: Chain,
    network: NetworkConfig,
    method: string,
    params: unknown[],
    label: string,
  ): Promise<T> {
    return jsonRpcWithFallback<T>({
      chain,
      endpoints: this.rpcUrls(network),
      method,
      params,
      label,
      timeoutMs: RPC_REQUEST_TIMEOUT_MS,
      logError: async (message, err) => {
        await w3n.log?.('error', message, err);
      },
    });
  }

  private async transferNative(
    secret: ResolvedAccountSecret,
    account: WalletAccount,
    network: NetworkConfig,
    request: TransferRequest,
  ): Promise<TransferResult> {
    return account.chain === 'ethereum'
      ? transferEthereumNative(secret, account, network, request)
      : transferSolanaNative(this.solanaRpc.bind(this), secret, account, network, request);
  }

  private async transferToken(
    secret: ResolvedAccountSecret,
    account: WalletAccount,
    network: NetworkConfig,
    request: TransferRequest,
  ): Promise<TransferResult> {
    if (!request.tokenId) {
      throw new Error('Token transfer requires a token id.');
    }
    const token = await this.getTokenForAccount(request.tokenId, account, network);
    return account.chain === 'ethereum'
      ? transferEthereumToken(secret, account, network, token, request)
      : transferSolanaToken(this.solanaRpc.bind(this), secret, account, network, token, request);
  }
}
