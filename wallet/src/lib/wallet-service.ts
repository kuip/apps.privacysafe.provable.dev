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
import { DEFAULT_NETWORKS, DEFAULT_TOKENS } from '@/lib/constants';
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
  Chain,
  ImportMnemonicRequest,
  ImportPrivateKeyRequest,
  NetworkConfig,
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

const VAULT_PATH = 'wallet-vault-v1.json';
const STATE_PATH = 'wallet-state-v1.json';
const SCRYPT_PARAMS = { n: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

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
    networks: [DEFAULT_NETWORKS.ethereum, DEFAULT_NETWORKS.solana] as NetworkConfig[],
    tokens: [...DEFAULT_TOKENS] as TokenConfig[],
    updatedAt: vault.updatedAt,
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
  return JSON.parse(utf8String(new Uint8Array(decrypted))) as VaultPlain;
}

function makeEmptyVault(): VaultPlain {
  const timestamp = nowIso();
  return {
    version: 1,
    accounts: [],
    secrets: {},
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

function solanaExplorer(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}`;
}

export class WalletService {
  private vault?: VaultPlain;
  private passphrase?: string;
  private vaultFile?: WalletVaultFile;
  private publicState?: WalletPublicState;

  async initialize(): Promise<void> {
    const localStore = await openJsonStore('local');
    const syncedStore = await openJsonStore('synced');
    this.vaultFile = await localStore.read<WalletVaultFile>(VAULT_PATH);
    this.publicState = await syncedStore.read<WalletPublicState>(STATE_PATH);
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
      networks: [DEFAULT_NETWORKS.ethereum, DEFAULT_NETWORKS.solana] as NetworkConfig[],
      tokens: [...DEFAULT_TOKENS] as TokenConfig[],
      updatedAt: nowIso(),
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
        networkKey: chain === 'ethereum' ? DEFAULT_NETWORKS.ethereum.key : DEFAULT_NETWORKS.solana.key,
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
      networkKey: request.chain === 'ethereum' ? DEFAULT_NETWORKS.ethereum.key : DEFAULT_NETWORKS.solana.key,
      secretKind: 'private-key',
      createdAt: nowIso(),
    };

    this.upsertAccount(account, secret);
    await this.persist();
    return publicStateFromVault(this.vault);
  }

  async getBalance(request: BalanceRequest): Promise<BalanceResult> {
    const account = await this.getAccount(request.accountId);
    if (request.tokenId) {
      const token = await this.getToken(request.tokenId);
      if (token.chain !== account.chain) {
        throw new Error('Token chain does not match account chain.');
      }
      return account.chain === 'ethereum'
        ? this.getEthereumTokenBalance(account, token)
        : this.getSolanaTokenBalance(account, token);
    }

    return account.chain === 'ethereum'
      ? this.getEthereumNativeBalance(account)
      : this.getSolanaNativeBalance(account);
  }

  async transfer(request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const account = await this.getAccount(request.accountId);
    if (request.tokenId) {
      const token = await this.getToken(request.tokenId);
      if (token.chain !== account.chain) {
        throw new Error('Token chain does not match account chain.');
      }
      return account.chain === 'ethereum'
        ? this.transferEthereumToken(account, token, request)
        : this.transferSolanaToken(account, token, request);
    }

    return account.chain === 'ethereum'
      ? this.transferEthereumNative(account, request)
      : this.transferSolanaNative(account, request);
  }

  async signMessage(request: SignMessageRequest): Promise<SignMessageResult> {
    assertUnlocked(this.vault);
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
    await localStore.write(VAULT_PATH, this.vaultFile);
    await syncedStore.write(STATE_PATH, this.publicState);
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

  private ethereumProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(DEFAULT_NETWORKS.ethereum.rpcUrl, DEFAULT_NETWORKS.ethereum.chainId);
  }

  private solanaConnection(): Connection {
    return new Connection(DEFAULT_NETWORKS.solana.rpcUrl, 'confirmed');
  }

  private async getEthereumNativeBalance(account: WalletAccount): Promise<BalanceResult> {
    const raw = await this.ethereumProvider().getBalance(account.address);
    return {
      accountId: account.id,
      symbol: DEFAULT_NETWORKS.ethereum.nativeSymbol,
      raw: raw.toString(),
      formatted: formatUnits(raw, 18),
    };
  }

  private async getSolanaNativeBalance(account: WalletAccount): Promise<BalanceResult> {
    const raw = await this.solanaConnection().getBalance(new PublicKey(account.address));
    return {
      accountId: account.id,
      symbol: DEFAULT_NETWORKS.solana.nativeSymbol,
      raw: String(raw),
      formatted: String(raw / LAMPORTS_PER_SOL),
    };
  }

  private async getEthereumTokenBalance(account: WalletAccount, token: TokenConfig): Promise<BalanceResult> {
    const contract = new ethers.Contract(token.address, ERC20_ABI, this.ethereumProvider());
    const raw = await contract.balanceOf(account.address) as bigint;
    return {
      accountId: account.id,
      symbol: token.symbol,
      raw: raw.toString(),
      formatted: formatUnits(raw, token.decimals),
    };
  }

  private async getSolanaTokenBalance(account: WalletAccount, token: TokenConfig): Promise<BalanceResult> {
    const owner = new PublicKey(account.address);
    const mint = new PublicKey(token.address);
    const accounts = await this.solanaConnection().getParsedTokenAccountsByOwner(owner, {
      mint,
    });
    const raw = accounts.value.reduce((sum, item) => {
      const amount = item.account.data.parsed.info.tokenAmount.amount as string;
      return sum + BigInt(amount);
    }, 0n);
    return {
      accountId: account.id,
      symbol: token.symbol,
      raw: raw.toString(),
      formatted: formatUnits(raw, token.decimals),
    };
  }

  private async transferEthereumNative(account: WalletAccount, request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const wallet = ethereumWalletFromSecret(secret).connect(this.ethereumProvider());
    const tx = await wallet.sendTransaction({
      to: request.to,
      value: parseUnits(request.amount, 18),
    });
    return {
      accountId: account.id,
      chain: account.chain,
      signature: tx.hash,
      explorerUrl: ethereumExplorer(tx.hash),
    };
  }

  private async transferEthereumToken(
    account: WalletAccount,
    token: TokenConfig,
    request: TransferRequest,
  ): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const wallet = ethereumWalletFromSecret(secret).connect(this.ethereumProvider());
    const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
    const tx = await contract.transfer(request.to, parseUnits(request.amount, token.decimals));
    return {
      accountId: account.id,
      chain: account.chain,
      signature: tx.hash,
      explorerUrl: ethereumExplorer(tx.hash),
    };
  }

  private async transferSolanaNative(account: WalletAccount, request: TransferRequest): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const keypair = solanaKeypairFromSecret(secret);
    const connection = this.solanaConnection();
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
      explorerUrl: solanaExplorer(signature),
    };
  }

  private async transferSolanaToken(
    account: WalletAccount,
    token: TokenConfig,
    request: TransferRequest,
  ): Promise<TransferResult> {
    assertUnlocked(this.vault);
    const secret = this.vault.secrets[account.id];
    const keypair = solanaKeypairFromSecret(secret);
    const connection = this.solanaConnection();
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
      explorerUrl: solanaExplorer(signature),
    };
  }
}
