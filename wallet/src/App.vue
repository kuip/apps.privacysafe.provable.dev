<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import { DEFAULT_TOKENS, WALLET_INTERNAL_SERVICE_NAME, WALLET_STATE_PATH, WALLET_VAULT_PATH } from '@/lib/constants';
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
const errorMessage = ref('');
const errorDetails = ref('');
const activeTab = ref<'home' | 'create' | 'settings' | 'history'>('home');
const generatedMnemonic = ref('');
const balanceByKey = ref<Record<string, BalanceResult>>({});
const balanceErrors = ref<Record<string, string>>({});
const balancesLoading = ref(false);
const lastTransfer = ref<TransferResult | null>(null);
const lastSignature = ref('');
const selectedNetworkKey = ref('');

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
});
const signForm = reactive({
  message: '',
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
const passwordInput = ref<HTMLInputElement | null>(null);
const passwordDialog = reactive({
  open: false,
  title: '',
  actionLabel: 'Continue',
  passphrase: '',
});
const backupDialog = reactive({
  open: false,
  phrase: '',
  path: '',
});
let passwordDialogResolve: ((value: string | null) => void) | undefined;
let balanceRefreshTimer: number | undefined;
let balanceRefreshSeq = 0;
let balanceRefreshQueued = false;

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
const nativeBalance = computed(() => (
  selectedAccount.value ? balanceByKey.value[balanceKey(selectedAccount.value.id)] : undefined
));
const trackedTokenRows = computed(() => (
  compatibleTokens.value.map(token => ({
    token,
    balance: selectedAccount.value ? balanceByKey.value[balanceKey(selectedAccount.value.id, token.id)] : undefined,
    error: selectedAccount.value ? balanceErrors.value[balanceKey(selectedAccount.value.id, token.id)] : undefined,
  }))
));

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

function setResult(_text: string): void {
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
}

function clearError(): void {
  errorMessage.value = '';
  errorDetails.value = '';
}

function balanceKey(accountId: string, tokenId = 'native'): string {
  return `${accountId}:${tokenId}`;
}

function balanceText(result: BalanceResult | undefined): string {
  return result ? `${result.formatted} ${result.symbol}` : 'Loading';
}

async function requestWalletPassword(title: string, actionLabel: string): Promise<string | null> {
  if (passwordDialogResolve) {
    passwordDialogResolve(null);
  }
  passwordDialog.title = title;
  passwordDialog.actionLabel = actionLabel;
  passwordDialog.passphrase = '';
  passwordDialog.open = true;
  await nextTick();
  passwordInput.value?.focus();
  return new Promise(resolve => {
    passwordDialogResolve = resolve;
  });
}

function closePasswordDialog(): void {
  passwordDialog.open = false;
  passwordDialog.passphrase = '';
  passwordDialogResolve?.(null);
  passwordDialogResolve = undefined;
}

function submitPasswordDialog(): void {
  if (!passwordDialog.passphrase) {
    return;
  }
  const passphrase = passwordDialog.passphrase;
  passwordDialog.open = false;
  passwordDialog.passphrase = '';
  passwordDialogResolve?.(passphrase);
  passwordDialogResolve = undefined;
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
  const tokensById = new Map([
    ...DEFAULT_TOKENS.map(token => [token.id, token] as const),
    ...(value?.tokens ?? []).map(token => [token.id, token] as const),
  ]);
  return {
    version: 1,
    accounts: value?.accounts ?? [],
    networks: value?.networks ?? [],
    tokens: Array.from(tokensById.values()) as TokenConfig[],
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
  state.value = normalizePublicState(await serviceCall<void, WalletPublicState>('getPublicState', undefined as void));
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
    await refreshSelectedBalances();
    setResult('');
  });
}

async function lock(): Promise<void> {
  await run(async () => {
    status.value = await serviceCall<void, WalletStatus>('lock', undefined as void);
    selectedAccountId.value = '';
    selectedTokenId.value = '';
    balanceByKey.value = {};
    balanceErrors.value = {};
    backupDialog.open = false;
    backupDialog.phrase = '';
    backupDialog.path = '';
    activeTab.value = 'home';
    setResult('');
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
    await refreshSelectedBalances();
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
    await refreshSelectedBalances();
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
    await refreshSelectedBalances();
    activeTab.value = 'home';
    setResult('Private key imported.');
  });
}

async function fetchBalance(accountId: string, tokenId?: string): Promise<void> {
  const key = balanceKey(accountId, tokenId);
  const result = await serviceCall<
    { accountId: string; tokenId?: string },
    BalanceResult
  >('getBalance', {
    accountId,
    tokenId,
  });
  balanceByKey.value = {
    ...balanceByKey.value,
    [key]: result,
  };
  const nextErrors = { ...balanceErrors.value };
  delete nextErrors[key];
  balanceErrors.value = nextErrors;
}

async function refreshSelectedBalances(): Promise<void> {
  const account = selectedAccount.value;
  if (!account || !status.value.unlocked) {
    return;
  }
  if (balancesLoading.value) {
    balanceRefreshQueued = true;
    return;
  }
  const seq = ++balanceRefreshSeq;
  balancesLoading.value = true;
  const tokenIds = compatibleTokens.value.map(token => token.id);
  const failed: Record<string, string> = {};

  for (const tokenId of [undefined, ...tokenIds]) {
    if (seq !== balanceRefreshSeq) {
      break;
    }
    const key = balanceKey(account.id, tokenId);
    try {
      await fetchBalance(account.id, tokenId);
    } catch (err) {
      failed[key] = humanMessage(err);
    }
  }

  if (seq === balanceRefreshSeq) {
    balanceErrors.value = {
      ...balanceErrors.value,
      ...failed,
    };
    balancesLoading.value = false;
    if (balanceRefreshQueued) {
      balanceRefreshQueued = false;
      void refreshSelectedBalances();
    }
  }
}

async function transfer(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  let passphrase: string | undefined;
  if (transferNeedsPassword.value) {
    const confirmedPassphrase = await requestWalletPassword('Confirm Transfer', 'Send');
    if (!confirmedPassphrase) {
      return;
    }
    passphrase = confirmedPassphrase;
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
      passphrase,
    });
    lastTransfer.value = result;
    await refresh();
    await refreshSelectedBalances();
    setResult(`Transfer submitted: ${result.signature}`);
  });
}

async function signMessage(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  let passphrase: string | undefined;
  if (signMessageNeedsPassword.value) {
    const confirmedPassphrase = await requestWalletPassword('Confirm Message Signing', 'Sign');
    if (!confirmedPassphrase) {
      return;
    }
    passphrase = confirmedPassphrase;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; message: string; passphrase?: string },
      SignMessageResult
    >('signMessage', {
      accountId: selectedAccountId.value,
      message: signForm.message,
      passphrase,
    });
    lastSignature.value = JSON.stringify(result, null, 2);
    setResult('Message signed.');
  });
}

async function revealRecoveryPhrase(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  const passphrase = await requestWalletPassword('Show Recovery Phrase', 'Show phrase');
  if (!passphrase) {
    return;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; passphrase: string },
      RevealRecoveryPhraseResult
    >('revealRecoveryPhrase', {
      accountId: selectedAccountId.value,
      passphrase,
    });
    backupDialog.phrase = result.mnemonic;
    backupDialog.path = result.derivationPath ?? '';
    backupDialog.open = true;
    setResult('');
  });
}

function closeBackupDialog(): void {
  backupDialog.open = false;
  backupDialog.phrase = '';
  backupDialog.path = '';
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
    balanceByKey.value = {};
    balanceErrors.value = {};
    generatedMnemonic.value = '';
    closeBackupDialog();
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
  if (!accountsForNetwork.value.some(account => account.id === selectedAccountId.value)) {
    selectedAccountId.value = accountsForNetwork.value[0]?.id ?? '';
  }
});
watch(selectedAccountId, () => {
  selectedTokenId.value = '';
  closeBackupDialog();
  void refreshSelectedBalances();
});
watch(() => compatibleTokens.value.map(token => token.id).join(','), () => {
  void refreshSelectedBalances();
});

onMounted(async () => {
  await run(loadInitialStateWithoutRpc);
  void refreshSelectedBalances();
  balanceRefreshTimer = window.setInterval(() => {
    void refreshSelectedBalances();
  }, 30000);
});

onUnmounted(() => {
  if (balanceRefreshTimer !== undefined) {
    window.clearInterval(balanceRefreshTimer);
  }
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

      <section v-if="activeTab === 'create'" class="tab-surface add-surface">
        <div class="add-name-row">
          <label class="add-name-field">
            <span>Account name</span>
            <input v-model.trim="addForm.accountName" autocomplete="off" />
          </label>
        </div>
        <div class="grid grid--setup">
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
        </div>
      </section>

      <section v-else-if="activeTab === 'home'" class="tab-surface home-grid">
        <article class="panel account-overview">
          <div class="panel__header">
            <div>
              <h2>{{ selectedAccount?.name || 'No account selected' }}</h2>
              <p v-if="selectedAccount" class="address-line">
                {{ selectedAccount.address }}
              </p>
              <p v-if="selectedAccount" class="account-balance">
                {{ nativeBalance ? `${nativeBalance.formatted} ${nativeBalance.symbol}` : balancesLoading ? 'Loading balance' : 'Balance unavailable' }}
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
        </article>

        <article class="panel token-balances-panel">
          <div class="panel__header">
            <h2>Tokens</h2>
            <button
              class="icon-action"
              :disabled="balancesLoading || !selectedAccount"
              title="Refresh balances"
              aria-label="Refresh balances"
              @click="refreshSelectedBalances"
            >
              <span aria-hidden="true">↻</span>
            </button>
          </div>
          <div v-if="trackedTokenRows.length" class="token-balance-list">
            <div v-for="row in trackedTokenRows" :key="row.token.id" class="token-balance-row">
              <span class="token-mark">{{ row.token.symbol.slice(0, 3) }}</span>
              <span class="token-meta">
                <strong>{{ row.token.symbol }}</strong>
                <small>{{ row.token.name }}</small>
              </span>
              <strong class="token-amount">{{ row.error ? 'Unavailable' : balanceText(row.balance) }}</strong>
              <small v-if="row.error" class="token-error">{{ row.error }}</small>
            </div>
          </div>
          <p v-else class="empty">No tracked tokens for this network.</p>
        </article>

        <div class="work-panels">
          <article class="subpanel">
            <h3>Transfer {{ selectedAssetSymbol }}</h3>
            <label>
              <span>Asset</span>
              <select v-model="selectedTokenId" :disabled="!selectedAccount">
                <option value="">{{ selectedNetwork?.nativeSymbol || 'Asset' }}</option>
                <option v-for="token in compatibleTokens" :key="token.id" :value="token.id">
                  {{ token.symbol }}
                </option>
              </select>
            </label>
            <label>
              <span>Recipient</span>
              <input v-model.trim="transferForm.to" autocomplete="off" />
            </label>
            <label>
              <span>Amount</span>
              <input v-model.trim="transferForm.amount" autocomplete="off" inputmode="decimal" />
            </label>
            <button
              class="btn btn--primary"
              :disabled="busy || !selectedAccount || !transferForm.to || !transferForm.amount"
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
            <button
              class="btn btn--primary"
              :disabled="busy || !selectedAccount || !signForm.message"
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
            <button class="btn btn--danger btn--muted-danger" :disabled="busy || !selectedAccount" @click="revealRecoveryPhrase">
              Show backup phrase
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

      <ErrorNotice
        v-if="errorMessage"
        :message="errorMessage"
        :details="errorDetails"
        @close="clearError"
      />

      <div v-if="passwordDialog.open" class="modal-backdrop" @click.self="closePasswordDialog">
        <section class="password-modal" role="dialog" aria-modal="true" :aria-labelledby="'password-dialog-title'">
          <div class="panel__header">
            <h2 id="password-dialog-title">{{ passwordDialog.title }}</h2>
            <button
              class="error-notice__close"
              :disabled="busy"
              title="Close"
              aria-label="Close"
              @click="closePasswordDialog"
            >
              ×
            </button>
          </div>
          <label>
            <span>Wallet password</span>
            <input
              ref="passwordInput"
              v-model="passwordDialog.passphrase"
              autocomplete="current-password"
              type="password"
              @keyup.enter="submitPasswordDialog"
              @keyup.esc="closePasswordDialog"
            />
          </label>
          <div class="modal-actions">
            <button class="btn btn--secondary" :disabled="busy" @click="closePasswordDialog">
              Cancel
            </button>
            <button class="btn btn--primary" :disabled="busy || !passwordDialog.passphrase" @click="submitPasswordDialog">
              {{ passwordDialog.actionLabel }}
            </button>
          </div>
        </section>
      </div>

      <div v-if="backupDialog.open" class="modal-backdrop" @click.self="closeBackupDialog">
        <section class="password-modal backup-modal" role="dialog" aria-modal="true" :aria-labelledby="'backup-dialog-title'">
          <div class="panel__header">
            <h2 id="backup-dialog-title">Backup Phrase</h2>
            <button
              class="error-notice__close"
              :disabled="busy"
              title="Close"
              aria-label="Close"
              @click="closeBackupDialog"
            >
              ×
            </button>
          </div>
          <div class="recovery-box">
            <span>Recovery phrase</span>
            <code>{{ backupDialog.phrase }}</code>
            <small v-if="backupDialog.path">{{ backupDialog.path }}</small>
          </div>
          <div class="modal-actions">
            <button class="btn btn--secondary" :disabled="busy" @click="copy(backupDialog.phrase)">
              Copy phrase
            </button>
            <button class="btn btn--primary" :disabled="busy" @click="closeBackupDialog">
              Close
            </button>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>
