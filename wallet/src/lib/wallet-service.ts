import { ethers } from 'ethers';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { scrypt } from '@noble/hashes/scrypt';
import { derivePath } from 'ed25519-hd-key';
import { Buffer } from 'buffer';
import { DEFAULT_NETWORK_LIST, DEFAULT_NETWORKS, DEFAULT_TOKENS, WALLET_STATE_PATH, WALLET_VAULT_PATH } from '@/lib/constants';
import {
  base64ToBytes,
  bytesToBase64,
  normalizeHex,
  parseSecretBytes,
  randomBytes,
  utf8Bytes,
  utf8String,
} from '@/lib/format';
import { openJsonStore } from '@/lib/storage';
import type {
  AccountSecret,
  BalanceRequest,
  BalanceResult,
  ChangePassphraseRequest,
  Chain,
  ImportMnemonicRequest,
  ImportPrivateKeyRequest,
  NetworkConfig,
  ResetVaultRequest,
  RevealRecoveryPhraseRequest,
  RevealRecoveryPhraseResult,
  SignMessageRequest,
  SignMessageResult,
  SignTransactionRequest,
  SignTransactionResult,
  TransactionHistoryEntry,
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

type WalletVaultFile = {
  version: 1;
  kdf: {
    name: 'scrypt';
    salt: string;
    n: number;
    r: number;
    p: number;
    dkLen: number;
  };
  cipher: {
    name: 'AES-GCM';
    iv: string;
    data: string;
  };
  updatedAt: string;
};

const SCRYPT_PARAMS = { n: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];
const ERC20_INTERFACE = new ethers.Interface(ERC20_ABI);

const DEFAULT_SETTINGS: WalletSettings = {
  requirePasswordForTransfers: true,
  requirePasswordForMessageSigning: false,
  requirePasswordForTransactionSigning: true,
  enableDevelopmentNetworks: false,
};
const RPC_REQUEST_TIMEOUT_MS = 12000;

function nowIso(): string {
  return new Date().toISOString();
}

function accountId(chain: Chain, address: string): string {
  return `${chain}:${address}`;
}

function publicStateFromVault(vault: VaultPlain): WalletPublicState {
  return {
    version: 1,
    accounts: vault.accounts,
    networks: [...DEFAULT_NETWORK_LIST] as NetworkConfig[],
    tokens: [...DEFAULT_TOKENS] as TokenConfig[],
    history: vault.history ?? [],
    settings: vault.settings ?? DEFAULT_SETTINGS,
    updatedAt: vault.updatedAt,
  };
}

function normalizePublicState(state: WalletPublicState | undefined): WalletPublicState | undefined {
  if (!state) {
    return undefined;
  }
  const defaultNetworkByKey = new Map<string, NetworkConfig>(
    DEFAULT_NETWORK_LIST.map(network => [network.key, network as NetworkConfig])
  );
  const tokensById = new Map([
    ...DEFAULT_TOKENS.map(token => [token.id, token] as const),
    ...(state.tokens ?? []).map(token => [token.id, token] as const),
  ]);
  const networksByKey = new Map<string, NetworkConfig>([
    ...DEFAULT_NETWORK_LIST.map(network => [network.key, network as NetworkConfig] as const),
    ...(state.networks ?? []).map(network => [
      network.key,
      {
        ...(defaultNetworkByKey.get(network.key) ?? {}),
        ...network,
        environment: network.environment ?? defaultNetworkByKey.get(network.key)?.environment ?? 'production',
      } as NetworkConfig,
    ] as const),
  ]);
  return {
    ...state,
    networks: Array.from(networksByKey.values()) as NetworkConfig[],
    tokens: Array.from(tokensById.values()) as TokenConfig[],
    history: state.history ?? [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(state.settings ?? {}),
    },
  };
}

function normalizeVault(vault: VaultPlain): VaultPlain {
  return {
    ...vault,
    history: vault.history ?? [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(vault.settings ?? {}),
    },
  };
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(scrypt(
    utf8Bytes(passphrase),
    salt,
    { N: SCRYPT_PARAMS.n, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, dkLen: SCRYPT_PARAMS.dkLen },
  ));
  try {
    return await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    keyBytes.fill(0);
  }
}

async function encryptVault(passphrase: string, vault: VaultPlain): Promise<WalletVaultFile> {
  const salt = new Uint8Array(randomBytes(16));
  const iv = new Uint8Array(randomBytes(12));
  const key = await deriveVaultKey(passphrase, salt);
  const plain = new Uint8Array(utf8Bytes(JSON.stringify(vault)));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));

  return {
    version: 1,
    kdf: {
      name: 'scrypt',
      salt: bytesToBase64(salt),
      ...SCRYPT_PARAMS,
    },
    cipher: {
      name: 'AES-GCM',
      iv: bytesToBase64(iv),
      data: bytesToBase64(encrypted),
    },
    updatedAt: vault.updatedAt,
  };
}

async function decryptVault(passphrase: string, file: WalletVaultFile): Promise<VaultPlain> {
  if (file.version !== 1 || file.kdf.name !== 'scrypt' || file.cipher.name !== 'AES-GCM') {
    throw new Error('Unsupported wallet vault format.');
  }

  const key = await deriveVaultKey(passphrase, base64ToBytes(file.kdf.salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64ToBytes(file.cipher.iv)) },
    key,
    new Uint8Array(base64ToBytes(file.cipher.data)),
  );
  return normalizeVault(JSON.parse(utf8String(new Uint8Array(decrypted))) as VaultPlain);
}

function makeEmptyVault(): VaultPlain {
  const timestamp = nowIso();
  return {
    version: 1,
    accounts: [],
    secrets: {},
    history: [],
    settings: { ...DEFAULT_SETTINGS },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function assertUnlocked(vault: VaultPlain | undefined): asserts vault is VaultPlain {
  if (!vault) {
    throw new Error('Wallet is locked.');
  }
}

function ethereumWalletFromSecret(secret: AccountSecret): ethers.Wallet | ethers.HDNodeWallet {
  if (secret.kind === 'mnemonic') {
    if (!secret.mnemonic || !secret.derivationPath) {
      throw new Error('Ethereum mnemonic account is missing derivation data.');
    }
    return ethers.HDNodeWallet.fromPhrase(secret.mnemonic, undefined, secret.derivationPath);
  }
  if (!secret.privateKey) {
    throw new Error('Ethereum private key account is missing key material.');
  }
  return new ethers.Wallet(normalizeHex(secret.privateKey));
}

function solanaKeypairFromSecret(secret: AccountSecret): Keypair {
  if (secret.kind === 'mnemonic') {
    if (!secret.mnemonic || !secret.derivationPath) {
      throw new Error('Solana mnemonic account is missing derivation data.');
    }
    const seed = mnemonicToSeedSync(secret.mnemonic);
    const derived = derivePath(secret.derivationPath, Buffer.from(seed).toString('hex')).key;
    return Keypair.fromSeed(derived);
  }
  if (!secret.privateKey) {
    throw new Error('Solana private key account is missing key material.');
  }
  const bytes = parseSecretBytes(secret.privateKey);
  if (bytes.length !== 32) {
    throw new Error('Solana private key import expects a 32-byte seed.');
  }
  return Keypair.fromSeed(bytes);
}

function formatUnits(raw: bigint, decimals: number): string {
  return ethers.formatUnits(raw, decimals);
}

function parseUnits(value: string, decimals: number): bigint {
  return ethers.parseUnits(value, decimals);
}

function ethereumExplorer(txHash: string): string {
  return `https://etherscan.io/tx/${txHash}`;
}

function ethereumExplorerFor(network: NetworkConfig, txHash: string): string {
  return network.key === 'ethereum:sepolia'
    ? `https://sepolia.etherscan.io/tx/${txHash}`
    : ethereumExplorer(txHash);
}

function solanaExplorer(signature: string, network?: NetworkConfig): string {
  const cluster = network?.key === 'solana:devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
};

type SolanaAccountInfoResult = {
  value: unknown | null;
};

type SolanaTokenBalanceResult = {
  value: {
    amount?: string;
  };
};

type SolanaBalanceResult = {
  value: number;
};

export class WalletService {
  private vault?: VaultPlain;
  private passphrase?: string;
  private vaultFile?: WalletVaultFile;
  private publicState?: WalletPublicState;

  async initialize(): Promise<void> {
    const localStore = await openJsonStore('local');
    const syncedStore = await openJsonStore('synced');
    this.vaultFile = await localStore.read<WalletVaultFile>(WALLET_VAULT_PATH);
    this.publicState = normalizePublicState(await syncedStore.read<WalletPublicState>(WALLET_STATE_PATH));
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

  async createMnemonic(): Promise<{ mnemonic: string }> {
    return { mnemonic: generateMnemonic(wordlist, 128) };
  }

  async unlock(request: UnlockRequest): Promise<WalletPublicState> {
    if (!this.vaultFile) {
      await this.initialize();
    }
    if (!this.vaultFile) {
      this.vault = makeEmptyVault();
      this.passphrase = request.passphrase;
      await this.persist();
      return publicStateFromVault(this.vault);
    }

    this.vault = await decryptVault(request.passphrase, this.vaultFile);
    this.passphrase = request.passphrase;
    this.publicState = publicStateFromVault(this.vault);
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
    return this.publicState ?? {
      version: 1,
      accounts: [],
      networks: [...DEFAULT_NETWORK_LIST] as NetworkConfig[],
      tokens: [...DEFAULT_TOKENS] as TokenConfig[],
      history: [],
      settings: { ...DEFAULT_SETTINGS },
      updatedAt: nowIso(),
    };
  }

  async updateSettings(settings: Partial<WalletSettings>): Promise<WalletPublicState> {
    assertUnlocked(this.vault);
    this.vault.settings = {
      ...DEFAULT_SETTINGS,
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

    const localStore = await openJsonStore('local');
    const syncedStore = await openJsonStore('synced');
    await localStore.delete(WALLET_VAULT_PATH);
    await syncedStore.delete(WALLET_STATE_PATH);

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
    const secret = this.vault.secrets[account.id];
    if (!secret?.mnemonic) {
      throw new Error('This account was imported from a private key and has no recovery phrase.');
    }
    return {
      accountId: account.id,
      mnemonic: secret.mnemonic,
      derivationPath: secret.derivationPath,
    };
  }

  async listAccounts(): Promise<WalletAccount[]> {
    const state = await this.getPublicState();
    return state.accounts;
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
    const added: WalletAccount[] = [];
    for (const chain of request.chains) {
      const path = chain === 'ethereum'
        ? `m/44'/60'/0'/0/${index}`
        : `m/44'/501'/${index}'/0'`;
      const secret: AccountSecret = {
        chain,
        kind: 'mnemonic',
        mnemonic,
        derivationPath: path,
      };
      const address = chain === 'ethereum'
        ? ethereumWalletFromSecret(secret).address
        : solanaKeypairFromSecret(secret).publicKey.toBase58();
      const account: WalletAccount = {
        id: accountId(chain, address),
        chain,
        name: request.name || `${chain === 'ethereum' ? 'Ethereum' : 'Solana'} ${index + 1}`,
        address,
        derivationPath: path,
        secretKind: 'mnemonic',
        createdAt: nowIso(),
      };
      this.upsertAccount(account, secret);
      added.push(account);
    }

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
        const token = await this.getToken(request.tokenId);
        if (token.chain !== account.chain) {
          throw new Error('Token chain does not match account chain.');
        }
        if (token.networkKey !== network.key) {
          throw new Error('Token network does not match selected network.');
        }
        return account.chain === 'ethereum'
          ? this.getEthereumTokenBalance(account, network, token)
          : this.getSolanaTokenBalance(account, network, token);
      }

      return account.chain === 'ethereum'
        ? this.getEthereumNativeBalance(account, network)
        : this.getSolanaNativeBalance(account, network);
    } catch (err) {
      if (/Could not reach .* RPC endpoint/i.test(errorMessage(err))) {
        throw err;
      }
      if (this.isNetworkFetchError(err)) {
        throw new Error(
          `Could not reach ${account.chain === 'ethereum' ? 'Ethereum' : 'Solana'} RPC endpoint. Balance is unavailable right now.`,
        );
      }
      throw err;
    }
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    await this.confirmIfRequired('transfer', request.passphrase);
    const account = await this.getAccount(request.accountId);
    const network = await this.getNetwork(request.networkKey, account.chain);
    let result: TransferResult;
    if (request.tokenId) {
      const token = await this.getToken(request.tokenId);
      if (token.chain !== account.chain) {
        throw new Error('Token chain does not match account chain.');
      }
      if (token.networkKey !== network.key) {
        throw new Error('Token network does not match selected network.');
      }
      result = await (account.chain === 'ethereum'
        ? this.transferEthereumToken(account, network, token, request)
        : this.transferSolanaToken(account, network, token, request));
      await this.tryRecordTransaction(account, network, request, result, token.symbol);
      return result;
    }

    result = await (account.chain === 'ethereum'
      ? this.transferEthereumNative(account, network, request)
      : this.transferSolanaNative(account, network, request));
    await this.tryRecordTransaction(account, network, request, result, network.nativeSymbol);
    return result;
  }

  async signMessage(request: SignMessageRequest): Promise<SignMessageResult> {
    assertUnlocked(this.vault);
    await this.confirmIfRequired('message-signing', request.passphrase);
    const account = await this.getAccount(request.accountId);
    const secret = this.vault.secrets[account.id];
    if (!secret) {
      throw new Error('No secret found for account.');
    }

    if (account.chain === 'ethereum') {
      const wallet = ethereumWalletFromSecret(secret);
      return {
        accountId: account.id,
        chain: account.chain,
        address: account.address,
        signature: await wallet.signMessage(request.message),
      };
    }

    const keypair = solanaKeypairFromSecret(secret);
    const bytes = utf8Bytes(request.message);
    const nacl = await import('tweetnacl');
    return {
      accountId: account.id,
      chain: account.chain,
      address: account.address,
      signature: bytesToBase64(nacl.sign.detached(bytes, keypair.secretKey)),
    };
  }

  async signTransaction(request: SignTransactionRequest): Promise<SignTransactionResult> {
    assertUnlocked(this.vault);
    await this.confirmIfRequired('transaction-signing', request.passphrase);
    const account = await this.getAccount(request.accountId);
    const secret = this.vault.secrets[account.id];
    if (!secret) {
      throw new Error('No secret found for account.');
    }

    if (account.chain === 'ethereum') {
      const wallet = ethereumWalletFromSecret(secret);
      const signed = await wallet.signTransaction(request.transaction as ethers.TransactionRequest);
      return {
        accountId: account.id,
        chain: account.chain,
        signedTransaction: signed,
        encoding: 'hex',
      };
    }

    if (request.encoding !== 'base64' || typeof request.transaction !== 'string') {
      throw new Error('Solana signTransaction expects a base64 serialized transaction.');
    }
    const keypair = solanaKeypairFromSecret(secret);
    const bytes = base64ToBytes(request.transaction);
    let signedBytes: Uint8Array;
    try {
      const versioned = VersionedTransaction.deserialize(bytes);
      versioned.sign([keypair]);
      signedBytes = versioned.serialize();
    } catch {
      const tx = Transaction.from(bytes);
      tx.partialSign(keypair);
      signedBytes = tx.serialize({ requireAllSignatures: false });
    }

    return {
      accountId: account.id,
      chain: account.chain,
      signedTransaction: bytesToBase64(signedBytes),
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

    const localStore = await openJsonStore('local');
    const syncedStore = await openJsonStore('synced');
    await localStore.write(WALLET_VAULT_PATH, this.vaultFile);
    await syncedStore.write(WALLET_STATE_PATH, this.publicState);
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
      ...DEFAULT_SETTINGS,
      ...this.vault.settings,
    };
    const required = operation === 'transfer'
      ? settings.requirePasswordForTransfers
      : operation === 'message-signing'
        ? settings.requirePasswordForMessageSigning
        : settings.requirePasswordForTransactionSigning;

    if (!required) {
      return;
    }
    await this.confirmPassphrase(passphrase);
  }

  private async recordTransaction(
    account: WalletAccount,
    network: NetworkConfig,
    request: TransferRequest,
    result: TransferResult,
    assetSymbol: string,
  ): Promise<void> {
    assertUnlocked(this.vault);
    const entry: TransactionHistoryEntry = {
      id: `${Date.now()}:${result.signature}`,
      accountId: account.id,
      chain: account.chain,
      networkKey: network.key,
      assetSymbol,
      amount: request.amount,
      to: request.to,
      signature: result.signature,
      explorerUrl: result.explorerUrl,
      createdAt: nowIso(),
    };
    this.vault.history = [entry, ...(this.vault.history ?? [])].slice(0, 100);
    await this.persist();
  }

  private async tryRecordTransaction(
    account: WalletAccount,
    network: NetworkConfig,
    request: TransferRequest,
    result: TransferResult,
    assetSymbol: string,
  ): Promise<void> {
    try {
      await this.recordTransaction(account, network, request, result, assetSymbol);
    } catch (err) {
      await w3n.log?.('error', 'Wallet failed to record transaction history', err);
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

  private ethereumProvider(network: NetworkConfig, rpcUrl: string = network.rpcUrl): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(rpcUrl, network.chainId);
  }

  private solanaConnection(network: NetworkConfig, rpcUrl: string = network.rpcUrl): Connection {
    return new Connection(rpcUrl, 'confirmed');
  }

  private isNetworkFetchError(err: unknown): boolean {
    const text = err instanceof Error
      ? `${err.message}\n${err.stack ?? ''}`
      : typeof err === 'object' && err
        ? JSON.stringify(err)
        : String(err);
    return /Failed to fetch|network|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|timed out|timeout|HTTP (403|408|425|429|5\d\d)|Too many connections|rate limit|forbidden/i.test(text);
  }

  private async withRpcFallback<T>(
    chain: Chain,
    urls: string[],
    operation: (rpcUrl: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    const attempts: string[] = [];
    for (const url of urls) {
      try {
        return await operation(url);
      } catch (err) {
        attempts.push(`${url}: ${errorMessage(err)}`);
        if (!this.isNetworkFetchError(err)) {
          throw err;
        }
        lastError = err;
      }
    }
    await w3n.log?.('error', `Wallet could not reach ${chain} RPC endpoints: ${attempts.join(' | ')}`, lastError);
    throw new Error(
      `Could not reach ${chain === 'ethereum' ? 'Ethereum' : 'Solana'} RPC endpoint. Balance is unavailable right now. Tried ${urls.length} endpoints: ${attempts.join(' | ')}`,
    );
  }

  private async jsonRpc<T>(
    rpcUrl: string,
    method: string,
    params: unknown[],
    contentType = 'application/json',
  ): Promise<T> {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': contentType,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`RPC ${method} timed out for ${rpcUrl} after ${RPC_REQUEST_TIMEOUT_MS}ms.`);
      }
      throw new Error(`RPC ${method} fetch failed for ${rpcUrl}: ${errorMessage(err)}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`RPC ${method} failed for ${rpcUrl} with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}.`);
    }
    const payload = await response.json() as JsonRpcResponse<T>;
    if (payload.error) {
      const code = payload.error.code === undefined ? '' : ` ${payload.error.code}`;
      throw new Error(`RPC ${method} failed for ${rpcUrl}${code}: ${payload.error.message ?? 'Unknown RPC error'}.`);
    }
    if (payload.result === undefined) {
      throw new Error(`RPC ${method} returned no result from ${rpcUrl}.`);
    }
    return payload.result;
  }

  private async getEthereumNativeBalance(account: WalletAccount, network: NetworkConfig): Promise<BalanceResult> {
    return this.withRpcFallback('ethereum', this.rpcUrls(network), async rpcUrl => {
      const rawHex = await this.jsonRpc<string>(
        rpcUrl,
        'eth_getBalance',
        [account.address, 'latest'],
      );
      const raw = BigInt(rawHex);
      return {
        accountId: account.id,
        symbol: network.nativeSymbol,
        raw: raw.toString(),
        formatted: formatUnits(raw, 18),
      };
    });
  }

  private async getSolanaNativeBalance(account: WalletAccount, network: NetworkConfig): Promise<BalanceResult> {
    return this.withRpcFallback('solana', this.rpcUrls(network), async rpcUrl => {
      const result = await this.jsonRpc<SolanaBalanceResult>(rpcUrl, 'getBalance', [account.address]);
      const raw = result.value;
      return {
        accountId: account.id,
        symbol: network.nativeSymbol,
        raw: String(raw),
        formatted: String(raw / LAMPORTS_PER_SOL),
      };
    });
  }

  private async getEthereumTokenBalance(account: WalletAccount, network: NetworkConfig, token: TokenConfig): Promise<BalanceResult> {
    return this.withRpcFallback('ethereum', this.rpcUrls(network), async rpcUrl => {
      const data = ERC20_INTERFACE.encodeFunctionData('balanceOf', [account.address]);
      const rawHex = await this.jsonRpc<string>(
        rpcUrl,
        'eth_call',
        [{ to: token.address, data }, 'latest'],
      );
      const [raw] = ERC20_INTERFACE.decodeFunctionResult('balanceOf', rawHex) as unknown as [bigint];
      return {
        accountId: account.id,
        symbol: token.symbol,
        raw: raw.toString(),
        formatted: formatUnits(raw, token.decimals),
      };
    });
  }

  private async getSolanaTokenBalance(account: WalletAccount, network: NetworkConfig, token: TokenConfig): Promise<BalanceResult> {
    return this.withRpcFallback('solana', this.rpcUrls(network), async rpcUrl => {
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(token.address),
        new PublicKey(account.address),
      );
      const accountInfo = await this.jsonRpc<SolanaAccountInfoResult>(rpcUrl, 'getAccountInfo', [
        tokenAccount.toBase58(),
        { encoding: 'base64' },
      ]);
      if (!accountInfo.value) {
        return {
          accountId: account.id,
          symbol: token.symbol,
          raw: '0',
          formatted: formatUnits(0n, token.decimals),
        };
      }
      const balance = await this.jsonRpc<SolanaTokenBalanceResult>(rpcUrl, 'getTokenAccountBalance', [
        tokenAccount.toBase58(),
      ]);
      const raw = BigInt(balance.value.amount ?? '0');
      return {
        accountId: account.id,
        symbol: token.symbol,
        raw: raw.toString(),
        formatted: formatUnits(raw, token.decimals),
      };
    });
  }

  private async transferEthereumNative(account: WalletAccount, network: NetworkConfig, request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const wallet = ethereumWalletFromSecret(secret).connect(this.ethereumProvider(network));
    const tx = await wallet.sendTransaction({
      to: request.to,
      value: parseUnits(request.amount, 18),
    });
    return {
      accountId: account.id,
      chain: account.chain,
      signature: tx.hash,
      explorerUrl: ethereumExplorerFor(network, tx.hash),
    };
  }

  private async transferEthereumToken(
    account: WalletAccount,
    network: NetworkConfig,
    token: TokenConfig,
    request: TransferRequest,
  ): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const wallet = ethereumWalletFromSecret(secret).connect(this.ethereumProvider(network));
    const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
    const tx = await contract.transfer(request.to, parseUnits(request.amount, token.decimals));
    return {
      accountId: account.id,
      chain: account.chain,
      signature: tx.hash,
      explorerUrl: ethereumExplorerFor(network, tx.hash),
    };
  }

  private async transferSolanaNative(account: WalletAccount, network: NetworkConfig, request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const keypair = solanaKeypairFromSecret(secret);
    const connection = this.solanaConnection(network);
    const transaction = new Transaction().add(SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(request.to),
      lamports: Number(parseUnits(request.amount, 9)),
    }));
    const signature = await connection.sendTransaction(transaction, [keypair]);
    return {
      accountId: account.id,
      chain: account.chain,
      signature,
      explorerUrl: solanaExplorer(signature, network),
    };
  }

  private async transferSolanaToken(
    account: WalletAccount,
    network: NetworkConfig,
    token: TokenConfig,
    request: TransferRequest,
  ): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const keypair = solanaKeypairFromSecret(secret);
    const connection = this.solanaConnection(network);
    const mint = new PublicKey(token.address);
    const recipient = new PublicKey(request.to);
    const sourceAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);
    const transaction = new Transaction();

    const recipientInfo = await connection.getAccountInfo(recipientAta);
    if (!recipientInfo) {
      transaction.add(createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        recipientAta,
        recipient,
        mint,
      ));
    }

    transaction.add(createTransferInstruction(
      sourceAta,
      recipientAta,
      keypair.publicKey,
      parseUnits(request.amount, token.decimals),
    ));
    const signature = await connection.sendTransaction(transaction, [keypair]);
    return {
      accountId: account.id,
      chain: account.chain,
      signature,
      explorerUrl: solanaExplorer(signature, network),
    };
  }
}
