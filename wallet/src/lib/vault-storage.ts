import { scrypt } from '@noble/hashes/scrypt';
import { DEFAULT_NETWORK_LIST, DEFAULT_TOKENS, WALLET_STATE_PATH, WALLET_VAULT_PATH } from '@/lib/constants';
import { base64ToBytes, bytesToBase64, randomBytes, utf8Bytes, utf8String } from '@/lib/format';
import { openJsonStore } from '@/lib/storage';
import type {
  NetworkConfig,
  SeedGroupSecret,
  TokenConfig,
  VaultPlain,
  WalletPublicState,
  WalletSeedGroup,
  WalletSettings,
} from '@/lib/types';

export type WalletVaultFile = {
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

export const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  requirePasswordForTransfers: true,
  requirePasswordForMessageSigning: false,
  requirePasswordForTransactionSigning: true,
  enableDevelopmentNetworks: false,
};

function nowIso(): string {
  return new Date().toISOString();
}

export function publicSeedGroup(group: SeedGroupSecret): WalletSeedGroup {
  const { mnemonic: _mnemonic, ...publicGroup } = group;
  return publicGroup;
}

export function makeEmptyPublicState(): WalletPublicState {
  return normalizePublicState({
    version: 1,
    accounts: [],
    seedGroups: [],
    networks: [...DEFAULT_NETWORK_LIST] as NetworkConfig[],
    tokens: [...DEFAULT_TOKENS] as TokenConfig[],
    history: [],
    settings: { ...DEFAULT_WALLET_SETTINGS },
    updatedAt: nowIso(),
  })!;
}

export function publicStateFromVault(vault: VaultPlain, state: WalletPublicState | undefined): WalletPublicState {
  const normalized = normalizePublicState(state) ?? makeEmptyPublicState();
  return {
    ...normalized,
    seedGroups: Object.values(vault.seedGroups ?? {}).map(publicSeedGroup),
    updatedAt: normalized.updatedAt || vault.updatedAt,
  };
}

export function normalizePublicState(state: WalletPublicState | undefined): WalletPublicState | undefined {
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
    seedGroups: state.seedGroups ?? [],
    networks: Array.from(networksByKey.values()) as NetworkConfig[],
    tokens: Array.from(tokensById.values()) as TokenConfig[],
    history: state.history ?? [],
    settings: {
      ...DEFAULT_WALLET_SETTINGS,
      ...(state.settings ?? {}),
    },
  };
}

function normalizeVault(vault: VaultPlain): VaultPlain {
  return {
    version: 1,
    seedGroups: vault.seedGroups ?? {},
    secrets: vault.secrets ?? {},
    createdAt: vault.createdAt ?? nowIso(),
    updatedAt: vault.updatedAt ?? nowIso(),
  };
}

export function makeEmptyVault(): VaultPlain {
  const timestamp = nowIso();
  return {
    version: 1,
    seedGroups: {},
    secrets: {},
    createdAt: timestamp,
    updatedAt: timestamp,
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

export async function encryptVault(passphrase: string, vault: VaultPlain): Promise<WalletVaultFile> {
  const salt = new Uint8Array(randomBytes(16));
  const iv = new Uint8Array(randomBytes(12));
  const key = await deriveVaultKey(passphrase, salt);
  const plain = new Uint8Array(utf8Bytes(JSON.stringify(vault)));
  try {
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
  } finally {
    plain.fill(0);
  }
}

export async function decryptVault(passphrase: string, file: WalletVaultFile): Promise<VaultPlain> {
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

export async function readWalletStores(): Promise<{
  vaultFile: WalletVaultFile | undefined;
  publicState: WalletPublicState | undefined;
}> {
  const syncedStore = await openJsonStore('synced');
  const [vaultFile, publicState] = await Promise.all([
    syncedStore.read<WalletVaultFile>(WALLET_VAULT_PATH),
    syncedStore.read<WalletPublicState>(WALLET_STATE_PATH),
  ]);
  return {
    vaultFile,
    publicState: normalizePublicState(publicState),
  };
}

export async function writeWalletStores(vaultFile: WalletVaultFile, publicState: WalletPublicState): Promise<void> {
  const syncedStore = await openJsonStore('synced');
  await syncedStore.write(WALLET_VAULT_PATH, vaultFile);
  await syncedStore.write(WALLET_STATE_PATH, normalizePublicState(publicState));
}

export async function deleteWalletStores(): Promise<void> {
  const syncedStore = await openJsonStore('synced');
  await syncedStore.delete(WALLET_VAULT_PATH);
  await syncedStore.delete(WALLET_STATE_PATH);
}
