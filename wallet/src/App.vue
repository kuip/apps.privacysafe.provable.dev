<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { WALLET_INTERNAL_SERVICE_NAME, WALLET_STATE_PATH, WALLET_VAULT_PATH } from '@/lib/constants';
import { callThisAppService } from '@/lib/json-rpc';
import { shortAddress } from '@/lib/format';
import { openJsonStore } from '@/lib/storage';
import type {
  BalanceResult,
  Chain,
  RevealRecoveryPhraseResult,
  SignMessageResult,
  TransactionHistoryEntry,
  TokenConfig,
  TransferResult,
  WalletPublicState,
  WalletSettings,
  WalletStatus,
} from '@/lib/types';

const defaultSettings: WalletSettings = {
  requirePasswordForTransfers: true,
  requirePasswordForMessageSigning: false,
  requirePasswordForTransactionSigning: true,
};

const status = ref<WalletStatus>({
  exists: false,
  unlocked: false,
  accountCount: 0,
});
const state = ref<WalletPublicState>({
  version: 1,
  accounts: [],
  networks: [],
  tokens: [],
  history: [],
  settings: { ...defaultSettings },
  updatedAt: '',
});
const selectedAccountId = ref('');
const selectedTokenId = ref('');
const busy = ref(false);
const message = ref('');
const errorMessage = ref('');
const errorDetails = ref('');
const activeTab = ref<'home' | 'create' | 'settings' | 'history'>('home');
const generatedMnemonic = ref('');
const balance = ref<BalanceResult | null>(null);
const lastTransfer = ref<TransferResult | null>(null);
const lastSignature = ref('');
const selectedNetworkKey = ref('');
const recoveryPhrase = ref('');
const recoveryPath = ref('');

const vaultForm = reactive({
  passphrase: '',
  confirmPassphrase: '',
});
const addForm = reactive({
  accountName: '',
});
const mnemonicForm = reactive({
  mnemonic: '',
});
const privateKeyForm = reactive({
  chain: 'ethereum' as Chain,
  privateKey: '',
});
const transferForm = reactive({
  to: '',
  amount: '',
  passphrase: '',
});
const signForm = reactive({
  message: '',
  passphrase: '',
});
const backupForm = reactive({
  passphrase: '',
});
const passwordForm = reactive({
  currentPassphrase: '',
  newPassphrase: '',
  confirmPassphrase: '',
});
const resetForm = reactive({
  passphrase: '',
  confirmText: '',
});
const settingsForm = reactive<WalletSettings>({ ...defaultSettings });

const selectedNetwork = computed(() => (
  state.value.networks.find(network => network.key === selectedNetworkKey.value)
));
const accountsForNetwork = computed(() => (
  state.value.accounts.filter(account => account.networkKey === selectedNetworkKey.value)
));
const selectedAccount = computed(() => (
  state.value.accounts.find(account => account.id === selectedAccountId.value)
));
const historyForSelectedAccount = computed<TransactionHistoryEntry[]>(() => (
  selectedAccountId.value
    ? (state.value.history ?? []).filter(entry => entry.accountId === selectedAccountId.value)
    : (state.value.history ?? [])
));

const compatibleTokens = computed<TokenConfig[]>(() => {
  const account = selectedAccount.value;
  if (!account) {
    return [];
  }
  return state.value.tokens.filter(token => token.chain === account.chain && token.networkKey === account.networkKey);
});

const selectedAssetSymbol = computed(() => {
  const token = compatibleTokens.value.find(item => item.id === selectedTokenId.value);
  if (token) {
    return token.symbol;
  }
  return selectedAccount.value?.chain === 'ethereum' ? 'ETH' : 'SOL';
});

const vaultConfirmMismatch = computed(() => (
  !status.value.exists
  && vaultForm.confirmPassphrase.length > 0
  && vaultForm.passphrase !== vaultForm.confirmPassphrase
));
const canSubmitVault = computed(() => (
  !!vaultForm.passphrase
  && (status.value.exists || (!!vaultForm.confirmPassphrase && vaultForm.passphrase === vaultForm.confirmPassphrase))
));
const passwordConfirmMismatch = computed(() => (
  passwordForm.confirmPassphrase.length > 0
  && passwordForm.newPassphrase !== passwordForm.confirmPassphrase
));
const transferNeedsPassword = computed(() => state.value.settings.requirePasswordForTransfers);
const signMessageNeedsPassword = computed(() => state.value.settings.requirePasswordForMessageSigning);

function setResult(text: string): void {
  message.value = text;
  errorMessage.value = '';
  errorDetails.value = '';
}

function stableDetails(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  if (typeof err === 'object' && err) {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function errorText(err: unknown): string {
  const details = stableDetails(err);
  if (err instanceof Error) {
    return `${err.message}\n${details}`;
  }
  if (typeof err === 'object' && err && 'message' in err) {
    return `${String((err as { message: unknown }).message)}\n${details}`;
  }
  return details;
}

function serviceCauseMessage(text: string): string {
  const messages = [...text.matchAll(/Error message:\s*([^\n]+)/g)]
    .map(match => match[1]?.trim())
    .filter(Boolean);
  const useful = [...messages].reverse().find(item => !/Error from other side of ipc/i.test(item));
  return useful ?? '';
}

function humanMessage(err: unknown): string {
  const record = (typeof err === 'object' && err) ? err as Record<string, unknown> : undefined;
  if (record?.callerNotAllowed) {
    return 'Wallet service access is not allowed. Reload or reinstall the app so the updated permissions are active.';
  }
  if (record?.serviceNotFound) {
    return 'Wallet service is not available yet. Restart the wallet app.';
  }
  if (record?.runtimeException) {
    return 'The wallet service returned an RPC error.';
  }

  const text = errorText(err);
  const cause = serviceCauseMessage(text);
  const summary = cause || text.split('\n').find(line => line.trim())?.trim() || '';
  if (/Could not reach .* RPC endpoint/i.test(summary)) {
    return summary;
  }
  if (/Failed to fetch/i.test(summary)) {
    return 'Could not reach the selected network RPC endpoint.';
  }
  if (/Error from other side of ipc/i.test(text)) {
    return summary && !/Error from other side of ipc/i.test(summary)
      ? summary
      : 'The wallet service failed while handling the request. Open details for the original error.';
  }
  if (err instanceof Error) {
    return err.message || 'Something went wrong.';
  } else if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message: unknown }).message);
  }

  return typeof err === 'string' ? err : 'Something went wrong.';
}

function setError(err: unknown): void {
  errorMessage.value = humanMessage(err);
  errorDetails.value = stableDetails(err);
  message.value = '';
}

function clearError(): void {
  errorMessage.value = '';
  errorDetails.value = '';
}

async function serviceCall<TRequest, TResponse>(method: string, payload: TRequest): Promise<TResponse> {
  return callThisAppService<TRequest, TResponse>(WALLET_INTERNAL_SERVICE_NAME, method, payload);
}

function syncSettingsForm(): void {
  Object.assign(settingsForm, {
    ...defaultSettings,
    ...state.value.settings,
  });
}

function normalizePublicState(value: WalletPublicState | undefined): WalletPublicState {
  return {
    version: 1,
    accounts: value?.accounts ?? [],
    networks: value?.networks ?? [],
    tokens: value?.tokens ?? [],
    history: value?.history ?? [],
    settings: {
      ...defaultSettings,
      ...(value?.settings ?? {}),
    },
    updatedAt: value?.updatedAt ?? '',
  };
}

function selectDefaultNetworkAndAccount(): void {
  if (!selectedNetworkKey.value && state.value.networks[0]) {
    selectedNetworkKey.value = state.value.networks[0].key;
  }
  if (selectedNetworkKey.value && !state.value.networks.some(network => network.key === selectedNetworkKey.value)) {
    selectedNetworkKey.value = state.value.networks[0]?.key ?? '';
  }
  if (!accountsForNetwork.value.some(account => account.id === selectedAccountId.value)) {
    selectedAccountId.value = accountsForNetwork.value[0]?.id ?? '';
  }
}

async function loadInitialStateWithoutRpc(): Promise<void> {
  const localStore = await openJsonStore('local');
  const syncedStore = await openJsonStore('synced');
  const [vaultFile, publicState] = await Promise.all([
    localStore.read<{ updatedAt?: string }>(WALLET_VAULT_PATH),
    syncedStore.read<WalletPublicState>(WALLET_STATE_PATH),
  ]);

  state.value = normalizePublicState(publicState);
  status.value = {
    exists: !!vaultFile,
    unlocked: false,
    accountCount: state.value.accounts.length,
    updatedAt: state.value.updatedAt || vaultFile?.updatedAt,
  };
  syncSettingsForm();
  selectDefaultNetworkAndAccount();
}

async function refresh(): Promise<void> {
  status.value = await serviceCall<void, WalletStatus>('status', undefined as void);
  state.value = await serviceCall<void, WalletPublicState>('getPublicState', undefined as void);
  syncSettingsForm();
  selectDefaultNetworkAndAccount();
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  errorMessage.value = '';
  errorDetails.value = '';
  try {
    await action();
  } catch (err) {
    setError(err);
  } finally {
    busy.value = false;
  }
}

async function unlockOrCreateVault(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall('unlock', { passphrase: vaultForm.passphrase });
    vaultForm.passphrase = '';
    vaultForm.confirmPassphrase = '';
    await refresh();
    setResult(status.value.exists ? 'Wallet unlocked.' : 'Wallet vault created.');
  });
}

async function lock(): Promise<void> {
  await run(async () => {
    status.value = await serviceCall<void, WalletStatus>('lock', undefined as void);
    selectedAccountId.value = '';
    selectedTokenId.value = '';
    balance.value = null;
    activeTab.value = 'home';
    setResult('Wallet locked.');
  });
}

async function saveSettings(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall<Partial<WalletSettings>, WalletPublicState>('updateSettings', settingsForm);
    syncSettingsForm();
    setResult('Settings saved.');
  });
}

async function createNewWallet(): Promise<void> {
  await run(async () => {
    const result = await serviceCall<void, { mnemonic: string }>('createMnemonic', undefined as void);
    generatedMnemonic.value = result.mnemonic;
    state.value = await serviceCall('importMnemonic', {
      mnemonic: result.mnemonic,
      chains: ['ethereum', 'solana'] satisfies Chain[],
      name: addForm.accountName || undefined,
    });
    mnemonicForm.mnemonic = '';
    await refresh();
    activeTab.value = 'home';
    setResult('New wallet created.');
  });
}

async function importMnemonic(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall('importMnemonic', {
      mnemonic: mnemonicForm.mnemonic,
      chains: ['ethereum', 'solana'] satisfies Chain[],
      name: addForm.accountName || undefined,
    });
    await refresh();
    activeTab.value = 'home';
    setResult('Wallet imported.');
  });
}

async function importPrivateKey(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall('importPrivateKey', {
      chain: privateKeyForm.chain,
      privateKey: privateKeyForm.privateKey,
      name: addForm.accountName || undefined,
    });
    privateKeyForm.privateKey = '';
    await refresh();
    activeTab.value = 'home';
    setResult('Private key imported.');
  });
}

async function loadBalance(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; tokenId?: string },
      BalanceResult
    >('getBalance', {
      accountId: selectedAccountId.value,
      tokenId: selectedTokenId.value || undefined,
    });
    balance.value = result;
    setResult(`${result.formatted} ${result.symbol}`);
  });
}

async function transfer(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; to: string; amount: string; tokenId?: string; passphrase?: string },
      TransferResult
    >('transfer', {
      accountId: selectedAccountId.value,
      to: transferForm.to,
      amount: transferForm.amount,
      tokenId: selectedTokenId.value || undefined,
      passphrase: transferNeedsPassword.value ? transferForm.passphrase : undefined,
    });
    transferForm.passphrase = '';
    lastTransfer.value = result;
    await refresh();
    setResult(`Transfer submitted: ${result.signature}`);
  });
}

async function signMessage(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; message: string; passphrase?: string },
      SignMessageResult
    >('signMessage', {
      accountId: selectedAccountId.value,
      message: signForm.message,
      passphrase: signMessageNeedsPassword.value ? signForm.passphrase : undefined,
    });
    signForm.passphrase = '';
    lastSignature.value = JSON.stringify(result, null, 2);
    setResult('Message signed.');
  });
}

async function revealRecoveryPhrase(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; passphrase: string },
      RevealRecoveryPhraseResult
    >('revealRecoveryPhrase', {
      accountId: selectedAccountId.value,
      passphrase: backupForm.passphrase,
    });
    recoveryPhrase.value = result.mnemonic;
    recoveryPath.value = result.derivationPath ?? '';
    backupForm.passphrase = '';
    setResult('Recovery phrase unlocked.');
  });
}

async function changePassphrase(): Promise<void> {
  await run(async () => {
    if (passwordForm.newPassphrase !== passwordForm.confirmPassphrase) {
      throw new Error('New wallet passwords do not match.');
    }
    status.value = await serviceCall('changePassphrase', {
      currentPassphrase: passwordForm.currentPassphrase,
      newPassphrase: passwordForm.newPassphrase,
    });
    passwordForm.currentPassphrase = '';
    passwordForm.newPassphrase = '';
    passwordForm.confirmPassphrase = '';
    setResult('Wallet password changed.');
  });
}

async function resetVault(): Promise<void> {
  await run(async () => {
    status.value = await serviceCall('resetVault', {
      passphrase: resetForm.passphrase,
    });
    state.value = normalizePublicState(undefined);
    selectedNetworkKey.value = '';
    selectedAccountId.value = '';
    selectedTokenId.value = '';
    generatedMnemonic.value = '';
    recoveryPhrase.value = '';
    recoveryPath.value = '';
    resetForm.passphrase = '';
    resetForm.confirmText = '';
    setResult('Wallet reset.');
  });
}

async function copy(text: string): Promise<void> {
  if (w3n.shell?.clipboard?.writeText) {
    await w3n.shell.clipboard.writeText(text);
  } else {
    await navigator.clipboard?.writeText(text);
  }
  setResult('Copied.');
}

async function openExternalUrl(url: string | undefined): Promise<void> {
  if (!url) {
    return;
  }
  await run(async () => {
    await w3n.shell?.openURL?.(url);
  });
}

watch(() => state.value.settings, syncSettingsForm, { deep: true });
watch(selectedNetworkKey, () => {
  selectedTokenId.value = '';
  balance.value = null;
  if (!accountsForNetwork.value.some(account => account.id === selectedAccountId.value)) {
    selectedAccountId.value = accountsForNetwork.value[0]?.id ?? '';
  }
});
watch(selectedAccountId, () => {
  selectedTokenId.value = '';
  balance.value = null;
  recoveryPhrase.value = '';
  recoveryPath.value = '';
});

onMounted(async () => {
  await run(loadInitialStateWithoutRpc);
});
</script>

<template>
  <main class="shell">
    <section v-if="!status.unlocked" class="vault-gate">
      <article class="vault-dialog">
        <img alt="Wallet" class="vault-logo" src="/logo.svg" />
        <div class="vault-copy">
          <h1>{{ status.exists ? 'Unlock Wallet' : 'Create Wallet Vault' }}</h1>
          <p>
            {{ status.exists
              ? 'Enter your wallet password to unlock local signing keys.'
              : 'Create the encrypted vault before importing or generating any wallet keys.' }}
          </p>
        </div>

        <div class="form-stack">
          <label>
            <span>Wallet password</span>
            <input
              v-model="vaultForm.passphrase"
              :autocomplete="status.exists ? 'current-password' : 'new-password'"
              type="password"
              @keyup.enter="canSubmitVault && unlockOrCreateVault()"
            />
          </label>
          <label v-if="!status.exists">
            <span>Confirm password</span>
            <input
              v-model="vaultForm.confirmPassphrase"
              autocomplete="new-password"
              type="password"
              @keyup.enter="canSubmitVault && unlockOrCreateVault()"
            />
          </label>
          <p v-if="vaultConfirmMismatch" class="field-error">Passwords do not match.</p>
          <button class="btn btn--primary" :disabled="busy || !canSubmitVault" @click="unlockOrCreateVault">
            {{ status.exists ? 'Unlock wallet' : 'Create vault' }}
          </button>
        </div>

        <ErrorNotice
          v-if="errorMessage"
          :message="errorMessage"
          :details="errorDetails"
          @close="clearError"
        />
      </article>
    </section>

    <template v-else>
      <header class="topbar">
        <div class="brand">
          <img alt="Wallet" class="brand__logo" src="/logo.svg" />
          <h1>Wallet</h1>
        </div>

        <div class="header-selectors">
          <label>
            <span>Network</span>
            <select v-model="selectedNetworkKey">
              <option v-for="network in state.networks" :key="network.key" :value="network.key">
                {{ network.name }}
              </option>
            </select>
          </label>
          <label>
            <span>Account</span>
            <select v-model="selectedAccountId" :disabled="accountsForNetwork.length === 0">
              <option v-if="accountsForNetwork.length === 0" value="">No account</option>
              <option v-for="account in accountsForNetwork" :key="account.id" :value="account.id">
                {{ account.name }} - {{ shortAddress(account.address) }}
              </option>
            </select>
          </label>
        </div>

        <button class="lock-toggle" :disabled="busy" title="Lock wallet" aria-label="Lock wallet" @click="lock">
          <span aria-hidden="true">🔓</span>
        </button>
      </header>

      <nav class="tabbar" aria-label="Wallet sections">
        <button class="tab-btn" :data-active="activeTab === 'home'" @click="activeTab = 'home'">
          <span aria-hidden="true">⌂</span>
          <span>Home</span>
        </button>
        <button class="tab-btn" :data-active="activeTab === 'create'" @click="activeTab = 'create'">
          <span aria-hidden="true">+</span>
          <span>Add</span>
        </button>
        <button class="tab-btn" :data-active="activeTab === 'history'" @click="activeTab = 'history'">
          <span aria-hidden="true">◷</span>
          <span>History</span>
        </button>
        <button class="tab-btn" :data-active="activeTab === 'settings'" @click="activeTab = 'settings'">
          <span aria-hidden="true">⚙</span>
          <span>Settings</span>
        </button>
      </nav>

      <section v-if="activeTab === 'create'" class="tab-surface grid grid--setup">
        <label class="add-name-field">
          <span>Account name</span>
          <input v-model.trim="addForm.accountName" autocomplete="off" />
        </label>
        <article class="panel">
          <div class="panel__header">
            <h2>Generate New Account</h2>
            <button class="btn btn--primary" :disabled="busy" @click="createNewWallet">
              Generate
            </button>
          </div>
          <div v-if="generatedMnemonic" class="recovery-box">
            <span>Recovery phrase for the wallet just created</span>
            <code>{{ generatedMnemonic }}</code>
            <button class="btn btn--secondary" :disabled="busy" @click="copy(generatedMnemonic)">
              Copy phrase
            </button>
          </div>
          <div class="panel-divider"></div>
          <div class="panel__header">
            <h2>Import Recovery Phrase</h2>
          </div>
          <textarea
            v-model.trim="mnemonicForm.mnemonic"
            rows="3"
            placeholder="BIP-39 mnemonic"
            spellcheck="false"
          />
          <button
            class="btn btn--primary"
            :disabled="busy || !mnemonicForm.mnemonic"
            @click="importMnemonic"
          >
            Import
          </button>
        </article>

        <article class="panel">
          <div class="panel__header">
            <h2>Import Private Key</h2>
          </div>
          <select v-model="privateKeyForm.chain">
            <option value="ethereum">Ethereum 32-byte private key</option>
            <option value="solana">Solana 32-byte seed</option>
          </select>
          <textarea
            v-model.trim="privateKeyForm.privateKey"
            rows="3"
            placeholder="Hex, base58, base64, or JSON byte array"
            spellcheck="false"
          />
          <button
            class="btn btn--primary"
            :disabled="busy || !privateKeyForm.privateKey"
            @click="importPrivateKey"
          >
            Import private key
          </button>
        </article>
      </section>

      <section v-else-if="activeTab === 'home'" class="tab-surface home-grid">
        <article class="panel account-overview">
          <div class="panel__header">
            <div>
              <h2>{{ selectedAccount?.name || 'No account selected' }}</h2>
              <p v-if="selectedAccount" class="address-line">
                {{ selectedAccount.address }}
              </p>
              <p v-else class="empty">Create or import an account to start.</p>
            </div>
            <button
              v-if="selectedAccount"
              class="icon-action"
              :disabled="busy"
              title="Copy address"
              aria-label="Copy address"
              @click="copy(selectedAccount.address)"
            >
              <span aria-hidden="true">⧉</span>
            </button>
          </div>

          <div class="asset-row">
            <select v-model="selectedTokenId" :disabled="!selectedAccount">
              <option value="">{{ selectedNetwork?.nativeSymbol || 'Asset' }}</option>
              <option v-for="token in compatibleTokens" :key="token.id" :value="token.id">
                {{ token.symbol }}
              </option>
            </select>
            <button class="btn btn--primary" :disabled="busy || !selectedAccount" @click="loadBalance">
              Balance
            </button>
            <div class="balance-box">
              {{ balance ? `${balance.formatted} ${balance.symbol}` : 'No balance loaded' }}
            </div>
          </div>
        </article>

        <div class="work-panels">
          <article class="subpanel">
            <h3>Transfer {{ selectedAssetSymbol }}</h3>
            <label>
              <span>Recipient</span>
              <input v-model.trim="transferForm.to" autocomplete="off" />
            </label>
            <label>
              <span>Amount</span>
              <input v-model.trim="transferForm.amount" autocomplete="off" inputmode="decimal" />
            </label>
            <label v-if="transferNeedsPassword">
              <span>Confirm wallet password</span>
              <input v-model="transferForm.passphrase" autocomplete="current-password" type="password" />
            </label>
            <button
              class="btn btn--primary"
              :disabled="busy || !selectedAccount || !transferForm.to || !transferForm.amount || (transferNeedsPassword && !transferForm.passphrase)"
              @click="transfer"
            >
              Send
            </button>
            <button v-if="lastTransfer?.explorerUrl" class="link-button tx-link" @click="openExternalUrl(lastTransfer.explorerUrl)">
              {{ shortAddress(lastTransfer.signature) }}
            </button>
          </article>

          <article class="subpanel">
            <h3>Sign Message</h3>
            <textarea
              v-model="signForm.message"
              rows="6"
              placeholder="Message content"
              spellcheck="false"
            />
            <label v-if="signMessageNeedsPassword">
              <span>Confirm wallet password</span>
              <input v-model="signForm.passphrase" autocomplete="current-password" type="password" />
            </label>
            <button
              class="btn btn--primary"
              :disabled="busy || !selectedAccount || !signForm.message || (signMessageNeedsPassword && !signForm.passphrase)"
              @click="signMessage"
            >
              Sign
            </button>
            <pre v-if="lastSignature">{{ lastSignature }}</pre>
          </article>
        </div>

        <article class="panel">
          <div class="panel__header">
            <h2>Backup</h2>
            <button class="btn btn--secondary" :disabled="busy || !selectedAccount || !backupForm.passphrase" @click="revealRecoveryPhrase">
              Show phrase
            </button>
          </div>
          <label>
            <span>Confirm wallet password</span>
            <input v-model="backupForm.passphrase" autocomplete="current-password" type="password" />
          </label>
          <div v-if="recoveryPhrase" class="recovery-box">
            <span>Recovery phrase</span>
            <code>{{ recoveryPhrase }}</code>
            <small v-if="recoveryPath">{{ recoveryPath }}</small>
            <button class="btn btn--secondary" :disabled="busy" @click="copy(recoveryPhrase)">
              Copy phrase
            </button>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'history'" class="tab-surface panel history-panel">
        <div class="panel__header">
          <h2>History</h2>
        </div>
        <div v-if="historyForSelectedAccount.length" class="history-list">
          <button
            v-for="entry in historyForSelectedAccount"
            :key="entry.id"
            class="history-row"
            :disabled="!entry.explorerUrl"
            @click="openExternalUrl(entry.explorerUrl)"
          >
            <span class="chain-mark">{{ entry.chain === 'ethereum' ? 'ETH' : 'SOL' }}</span>
            <span>
              <strong>{{ entry.amount }} {{ entry.assetSymbol }}</strong>
              <small>{{ shortAddress(entry.to) }} · {{ new Date(entry.createdAt).toLocaleString() }}</small>
            </span>
            <code>{{ shortAddress(entry.signature) }}</code>
          </button>
        </div>
        <p v-else class="empty">No transactions recorded for the selected account.</p>
      </section>

      <section v-else class="tab-surface settings-grid">
        <article class="panel">
          <div class="panel__header">
            <h2>Signing Rules</h2>
          </div>
          <label class="toggle-row">
            <span>
              <strong>Require password for transfers</strong>
              <small>Applies to ETH, SOL, ERC-20, and SPL token transfers.</small>
            </span>
            <input v-model="settingsForm.requirePasswordForTransfers" type="checkbox" />
          </label>
          <label class="toggle-row">
            <span>
              <strong>Require password for message signing</strong>
              <small>Applies to direct signMessage requests.</small>
            </span>
            <input v-model="settingsForm.requirePasswordForMessageSigning" type="checkbox" />
          </label>
          <label class="toggle-row">
            <span>
              <strong>Require password for transaction signing</strong>
              <small>Applies to raw transaction signing from other PrivacySafe apps.</small>
            </span>
            <input v-model="settingsForm.requirePasswordForTransactionSigning" type="checkbox" />
          </label>
          <button class="btn btn--primary" :disabled="busy" @click="saveSettings">Save settings</button>
        </article>

        <article class="panel">
          <div class="panel__header">
            <h2>Change Password</h2>
          </div>
          <label>
            <span>Current password</span>
            <input v-model="passwordForm.currentPassphrase" autocomplete="current-password" type="password" />
          </label>
          <label>
            <span>New password</span>
            <input v-model="passwordForm.newPassphrase" autocomplete="new-password" type="password" />
          </label>
          <label>
            <span>Confirm new password</span>
            <input v-model="passwordForm.confirmPassphrase" autocomplete="new-password" type="password" />
          </label>
          <p v-if="passwordConfirmMismatch" class="field-error">Passwords do not match.</p>
          <button
            class="btn btn--primary"
            :disabled="busy || !passwordForm.currentPassphrase || !passwordForm.newPassphrase || passwordConfirmMismatch"
            @click="changePassphrase"
          >
            Change password
          </button>
        </article>

        <article class="panel danger-panel">
          <div class="panel__header">
            <h2>Reset Wallet</h2>
          </div>
          <label>
            <span>Wallet password</span>
            <input v-model="resetForm.passphrase" autocomplete="current-password" type="password" />
          </label>
          <label>
            <span>Type DELETE</span>
            <input v-model.trim="resetForm.confirmText" autocomplete="off" />
          </label>
          <button
            class="btn btn--danger"
            :disabled="busy || !resetForm.passphrase || resetForm.confirmText !== 'DELETE'"
            @click="resetVault"
          >
            Delete vault
          </button>
        </article>
      </section>

      <footer v-if="!errorMessage" class="status-bar">
        {{ message || 'Wallet signer service is ready.' }}
      </footer>
      <ErrorNotice
        v-else
        :message="errorMessage"
        :details="errorDetails"
        @close="clearError"
      />
    </template>
  </main>
</template>
