<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import AddAccountTab from '@/components/AddAccountTab.vue';
import ApprovalDialog from '@/components/ApprovalDialog.vue';
import BackupDialog from '@/components/BackupDialog.vue';
import ErrorNotice from '@/components/ErrorNotice.vue';
import HistoryTab from '@/components/HistoryTab.vue';
import HomeTab from '@/components/HomeTab.vue';
import PasswordDialog from '@/components/PasswordDialog.vue';
import SettingsTab from '@/components/SettingsTab.vue';
import VaultGate from '@/components/VaultGate.vue';
import WalletHeader from '@/components/WalletHeader.vue';
import WalletTabBar from '@/components/WalletTabBar.vue';
import { DEFAULT_NETWORK_LIST, DEFAULT_TOKENS, WALLET_INTERNAL_SERVICE_NAME, WALLET_SERVICE_NAME } from '@/lib/constants';
import { callThisAppService, decodeJson, encodeJson } from '@/lib/json-rpc';
import { shortAddress } from '@/lib/format';
import { EXTERNAL_WALLET_METHODS } from '@/lib/service-permissions';
import { readWalletStores } from '@/lib/vault-storage';
import type {
  BalanceResult,
  Chain,
  CreateAccountResult,
  NetworkConfig,
  RevealAccountPrivateKeyResult,
  RevealRecoveryPhraseResult,
  SignMessageResult,
  TransactionHistoryEntry,
  TransactionStatus,
  TokenConfig,
  TransferResult,
  WalletPublicState,
  WalletSettings,
  WalletStatus,
} from '@/lib/types';

type CallStart = {
  msgType: 'start';
  callNum: number;
  method: string;
  data?: web3n.rpc.PassedDatum;
};

type ExternalWalletMethod = typeof EXTERNAL_WALLET_METHODS[number];
type ApprovalResult = {
  approved: boolean;
  passphrase?: string;
};

const defaultSettings: WalletSettings = {
  requirePasswordForTransfers: true,
  requirePasswordForMessageSigning: false,
  requirePasswordForTransactionSigning: true,
  enableDevelopmentNetworks: false,
};

const status = ref<WalletStatus>({
  exists: false,
  unlocked: false,
  accountCount: 0,
});
const state = ref<WalletPublicState>({
  version: 1,
  accounts: [],
  seedGroups: [],
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
const selectedSeedGroupId = ref('');
const expandedHistoryId = ref('');
const historyPage = ref(1);
const historyPageSize = ref(10);
const historyPageSizeOptions = [10, 50, 100] as const;
const copyFallbackText = ref('');
const copyFallbackField = ref<HTMLTextAreaElement | null>(null);

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
const passwordDialog = reactive({
  open: false,
  title: '',
  actionLabel: 'Continue',
  passphrase: '',
});
const backupDialog = reactive({
  open: false,
  title: '',
  label: '',
  value: '',
  path: '',
  copyLabel: '',
});
const approvalDialog = reactive({
  open: false,
  method: '' as ExternalWalletMethod | '',
  title: '',
  actionLabel: 'Approve',
  payload: undefined as Record<string, unknown> | undefined,
  waitingForUnlock: false,
});
let passwordDialogResolve: ((value: string | null) => void) | undefined;
let approvalDialogResolve: ((value: ApprovalResult | null) => void) | undefined;
let balanceRefreshTimer: number | undefined;
let transferStatusRefreshTimer: number | undefined;
let balanceRefreshSeq = 0;
let balanceRefreshQueued = false;
let externalWalletServiceExposed = false;

const externalMethodSet = new Set<string>(EXTERNAL_WALLET_METHODS);
const approvalRequiredMethods = new Set<string>(['transfer', 'signMessage', 'signTransaction']);

const availableNetworks = computed(() => (
  state.value.networks.filter(network => (
    network.environment === 'production' || state.value.settings.enableDevelopmentNetworks
  ))
));
const selectedNetwork = computed(() => (
  availableNetworks.value.find(network => network.key === selectedNetworkKey.value)
));
const accountsForNetwork = computed(() => (
  selectedNetwork.value
    ? state.value.accounts.filter(account => account.chain === selectedNetwork.value?.chain)
    : []
));
const selectedAccount = computed(() => (
  state.value.accounts.find(account => account.id === selectedAccountId.value)
));
const historyForSelectedAccount = computed<TransactionHistoryEntry[]>(() => (
  (state.value.history ?? [])
    .filter(entry => (
      (!selectedAccountId.value || entry.accountId === selectedAccountId.value)
      && (!selectedNetworkKey.value || entry.networkKey === selectedNetworkKey.value)
    ))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
));
const historyPageCount = computed(() => (
  Math.max(1, Math.ceil(historyForSelectedAccount.value.length / historyPageSize.value))
));
const pagedHistory = computed(() => {
  const start = (historyPage.value - 1) * historyPageSize.value;
  return historyForSelectedAccount.value.slice(start, start + historyPageSize.value);
});

const compatibleTokens = computed<TokenConfig[]>(() => {
  const account = selectedAccount.value;
  if (!account) {
    return [];
  }
  return state.value.tokens.filter(token => (
    token.chain === account.chain && token.networkKey === selectedNetworkKey.value
  ));
});

const selectedAssetSymbol = computed(() => {
  const token = compatibleTokens.value.find(item => item.id === selectedTokenId.value);
  if (token) {
    return token.symbol;
  }
  return selectedNetwork.value?.nativeSymbol ?? (selectedAccount.value?.chain === 'ethereum' ? 'ETH' : 'SOL');
});
const nativeBalance = computed(() => (
  selectedAccount.value ? balanceByKey.value[balanceKey(selectedAccount.value.id, 'native', selectedNetworkKey.value)] : undefined
));
const trackedTokenRows = computed(() => (
  compatibleTokens.value.map(token => ({
    token,
    balance: selectedAccount.value ? balanceByKey.value[balanceKey(selectedAccount.value.id, token.id, selectedNetworkKey.value)] : undefined,
    error: selectedAccount.value ? balanceErrors.value[balanceKey(selectedAccount.value.id, token.id, selectedNetworkKey.value)] : undefined,
  }))
));
const approvalRows = computed(() => {
  const payload = approvalDialog.payload ?? {};
  const accountId = typeof payload.accountId === 'string' ? payload.accountId : '';
  const account = state.value.accounts.find(item => item.id === accountId);
  const networkKey = typeof payload.networkKey === 'string' ? payload.networkKey : selectedNetworkKey.value;
  const network = state.value.networks.find(item => item.key === networkKey);
  const tokenId = typeof payload.tokenId === 'string' ? payload.tokenId : '';
  const token = state.value.tokens.find(item => item.id === tokenId);
  const rows = [
    ['Requester', 'External PrivacySafe app'],
    ['Action', approvalDialog.title || 'Wallet request'],
  ];

  if (account) {
    rows.push(['Account', `${account.name} - ${shortAddress(account.address)}`]);
  } else if (accountId) {
    rows.push(['Account', accountId]);
  }
  if (network) {
    rows.push(['Network', network.name]);
  }

  if (approvalDialog.method === 'transfer') {
    const amount = typeof payload.amount === 'string' ? payload.amount : '';
    const to = typeof payload.to === 'string' ? payload.to : '';
    rows.push(['Asset', token?.symbol ?? network?.nativeSymbol ?? 'Native coin']);
    if (amount) {
      rows.push(['Amount', amount]);
    }
    if (to) {
      rows.push(['Recipient', to]);
    }
  } else if (approvalDialog.method === 'signMessage') {
    const message = typeof payload.message === 'string' ? payload.message : '';
    rows.push(['Message', message.length > 240 ? `${message.slice(0, 240)}...` : message]);
  } else if (approvalDialog.method === 'signTransaction') {
    rows.push(['Encoding', typeof payload.encoding === 'string' ? payload.encoding : 'json']);
    rows.push(['Transaction', approvalPayloadText(payload, 300)]);
  }

  return rows.filter(([, value]) => !!value);
});
const approvalPayloadPreview = computed(() => approvalPayloadText(approvalDialog.payload));

const vaultConfirmMismatch = computed(() => (
  !status.value.exists
  && vaultForm.confirmPassphrase.length > 0
  && vaultForm.passphrase !== vaultForm.confirmPassphrase
));
const canSubmitVault = computed(() => (
  !!vaultForm.passphrase
  && (status.value.exists || (
    vaultForm.passphrase.length >= 4
    && !!vaultForm.confirmPassphrase
    && vaultForm.passphrase === vaultForm.confirmPassphrase
  ))
));
const vaultPasswordTooShort = computed(() => (
  !status.value.exists
  && vaultForm.passphrase.length > 0
  && vaultForm.passphrase.length < 4
));
const passwordConfirmMismatch = computed(() => (
  passwordForm.confirmPassphrase.length > 0
  && passwordForm.newPassphrase !== passwordForm.confirmPassphrase
));
const newPasswordTooShort = computed(() => (
  passwordForm.newPassphrase.length > 0
  && passwordForm.newPassphrase.length < 4
));
const transferNeedsPassword = computed(() => state.value.settings.requirePasswordForTransfers);
const signMessageNeedsPassword = computed(() => state.value.settings.requirePasswordForMessageSigning);
const canRevealBackupPhrase = computed(() => selectedAccount.value?.secretKind === 'mnemonic');

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

function approvalPayloadText(value: unknown, maxLength = 2000): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? '';
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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

function balanceKey(accountId: string, tokenId = 'native', networkKey = selectedNetworkKey.value): string {
  return `${networkKey}:${accountId}:${tokenId}`;
}

async function requestWalletPassword(title: string, actionLabel: string): Promise<string | null> {
  if (passwordDialogResolve) {
    passwordDialogResolve(null);
  }
  passwordDialog.title = title;
  passwordDialog.actionLabel = actionLabel;
  passwordDialog.passphrase = '';
  passwordDialog.open = true;
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

function approvalTitle(method: string): string {
  switch (method) {
    case 'transfer':
      return 'Approve Transfer';
    case 'signMessage':
      return 'Approve Message Signing';
    case 'signTransaction':
      return 'Approve Transaction Signing';
    default:
      return 'Approve Wallet Request';
  }
}

function approvalActionLabel(method: string): string {
  switch (method) {
    case 'transfer':
      return 'Approve transfer';
    case 'signMessage':
      return 'Approve signing';
    case 'signTransaction':
      return 'Approve transaction';
    default:
      return 'Approve';
  }
}

function externalRequestNeedsPassword(method: string): boolean {
  const settings = state.value.settings;
  if (method === 'transfer') {
    return settings.requirePasswordForTransfers;
  }
  if (method === 'signMessage') {
    return settings.requirePasswordForMessageSigning;
  }
  if (method === 'signTransaction') {
    return settings.requirePasswordForTransactionSigning;
  }
  return false;
}

async function requestExternalApproval(
  method: ExternalWalletMethod,
  payload: Record<string, unknown>,
): Promise<ApprovalResult | null> {
  if (approvalDialogResolve) {
    throw new Error('Wallet is already reviewing another external request.');
  }

  approvalDialog.open = true;
  approvalDialog.method = method;
  approvalDialog.title = approvalTitle(method);
  approvalDialog.actionLabel = approvalActionLabel(method);
  approvalDialog.payload = payload;
  approvalDialog.waitingForUnlock = !status.value.unlocked;
  activeTab.value = 'home';

  return new Promise(resolve => {
    approvalDialogResolve = resolve;
  });
}

function closeExternalApproval(): void {
  approvalDialog.open = false;
  approvalDialog.method = '';
  approvalDialog.title = '';
  approvalDialog.actionLabel = 'Approve';
  approvalDialog.payload = undefined;
  approvalDialog.waitingForUnlock = false;
  approvalDialogResolve = undefined;
}

function rejectExternalApproval(): void {
  approvalDialogResolve?.(null);
  closeExternalApproval();
}

async function approveExternalApproval(): Promise<void> {
  if (!approvalDialog.method) {
    return;
  }

  let passphrase: string | undefined;
  if (externalRequestNeedsPassword(approvalDialog.method)) {
    const confirmedPassphrase = await requestWalletPassword('Confirm External Request', 'Approve');
    if (!confirmedPassphrase) {
      return;
    }
    passphrase = confirmedPassphrase;
  }

  approvalDialogResolve?.({ approved: true, passphrase });
  closeExternalApproval();
}

async function handleExternalWalletMethod(method: string, payload: unknown): Promise<unknown> {
  if (!externalMethodSet.has(method)) {
    throw new Error(`Method ${method} is not exposed by ${WALLET_SERVICE_NAME}.`);
  }

  if (!approvalRequiredMethods.has(method)) {
    return serviceCall(method, payload);
  }

  const requestPayload = (typeof payload === 'object' && payload)
    ? { ...(payload as Record<string, unknown>) }
    : {};
  delete requestPayload.passphrase;

  const approval = await requestExternalApproval(method as ExternalWalletMethod, requestPayload);
  if (!approval?.approved) {
    throw new Error('User rejected wallet request.');
  }

  const result = await serviceCall(method, {
    ...requestPayload,
    passphrase: approval.passphrase,
  });
  await syncExternalWalletResult(method, requestPayload, result);
  return result;
}

async function syncExternalWalletResult(
  method: string,
  payload: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  if (method !== 'transfer') {
    return;
  }

  await refresh();

  const accountId = typeof payload.accountId === 'string' ? payload.accountId : '';
  const networkKey = typeof payload.networkKey === 'string' ? payload.networkKey : '';
  if (networkKey && state.value.networks.some(network => network.key === networkKey)) {
    selectedNetworkKey.value = networkKey;
  }
  if (accountId && state.value.accounts.some(account => account.id === accountId)) {
    selectedAccountId.value = accountId;
  }
  activeTab.value = 'history';
  await refreshSelectedBalances();

  const transferResult = result as Partial<TransferResult>;
  if (transferResult.status === 'pending' && typeof transferResult.accountId === 'string' && typeof transferResult.signature === 'string') {
    pollPendingTransfer(transferResult.accountId, transferResult.signature);
  }
}

async function handleExternalWalletCall(connection: web3n.rpc.Connection, call: CallStart): Promise<void> {
  const { callNum, method, data } = call;
  try {
    const result = await handleExternalWalletMethod(method, decodeJson(data));
    await connection.send({
      callNum,
      callStatus: 'end',
      data: encodeJson(result),
    });
  } catch (err) {
    await connection.send({
      callNum,
      callStatus: 'error',
      err: err instanceof Error ? { message: err.message } : err,
    });
  }
}

function exposeExternalWalletService(): void {
  if (externalWalletServiceExposed || !w3n.rpc?.exposeService) {
    return;
  }
  externalWalletServiceExposed = true;
  w3n.rpc.exposeService(WALLET_SERVICE_NAME, {
    next(connection) {
      connection.watch({
        next: message => {
          const call = message as Partial<CallStart>;
          if (call.msgType === 'start') {
            void handleExternalWalletCall(connection, call as CallStart);
          }
        },
        error: err => {
          void w3n.log?.('error', 'Wallet external signer connection failed', err);
        },
      });
    },
    error: err => {
      externalWalletServiceExposed = false;
      void w3n.log?.('error', 'Wallet failed to expose external signer service', err);
    },
  });
}

function syncSettingsForm(): void {
  Object.assign(settingsForm, {
    ...defaultSettings,
    ...state.value.settings,
  });
}

function normalizePublicState(value: WalletPublicState | undefined): WalletPublicState {
  const defaultNetworkByKey = new Map<string, NetworkConfig>(
    DEFAULT_NETWORK_LIST.map(network => [network.key, network as NetworkConfig])
  );
  const networksByKey = new Map<string, NetworkConfig>([
    ...DEFAULT_NETWORK_LIST.map(network => [network.key, network as NetworkConfig] as const),
    ...(value?.networks ?? []).map(network => [
      network.key,
      {
        ...(defaultNetworkByKey.get(network.key) ?? {}),
        ...network,
        environment: network.environment ?? defaultNetworkByKey.get(network.key)?.environment ?? 'production',
      } as NetworkConfig,
    ] as const),
  ]);
  const tokensById = new Map([
    ...DEFAULT_TOKENS.map(token => [token.id, token] as const),
    ...(value?.tokens ?? []).map(token => [token.id, token] as const),
  ]);
  return {
    version: 1,
    accounts: value?.accounts ?? [],
    seedGroups: value?.seedGroups ?? [],
    networks: Array.from(networksByKey.values()),
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
  if (!selectedNetworkKey.value && availableNetworks.value[0]) {
    selectedNetworkKey.value = availableNetworks.value[0].key;
  }
  if (selectedNetworkKey.value && !availableNetworks.value.some(network => network.key === selectedNetworkKey.value)) {
    selectedNetworkKey.value = availableNetworks.value[0]?.key ?? '';
  }
  if (!accountsForNetwork.value.some(account => account.id === selectedAccountId.value)) {
    selectedAccountId.value = accountsForNetwork.value[0]?.id ?? '';
  }
  if (selectedSeedGroupId.value && !state.value.seedGroups.some(group => group.id === selectedSeedGroupId.value)) {
    selectedSeedGroupId.value = '';
  }
}

async function loadInitialStateWithoutRpc(): Promise<void> {
  const { vaultFile, publicState } = await readWalletStores();

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
    backupDialog.title = '';
    backupDialog.label = '';
    backupDialog.value = '';
    backupDialog.path = '';
    backupDialog.copyLabel = '';
    activeTab.value = 'home';
    setResult('');
  });
}

async function updateSetting(key: keyof WalletSettings): Promise<void> {
  const previousSettings = { ...state.value.settings };
  const nextSettings: WalletSettings = {
    ...previousSettings,
    [key]: settingsForm[key],
  };

  state.value = {
    ...state.value,
    settings: nextSettings,
  };
  selectDefaultNetworkAndAccount();
  setResult('');

  busy.value = true;
  try {
    state.value = normalizePublicState(
      await serviceCall<Partial<WalletSettings>, WalletPublicState>('updateSettings', {
        [key]: settingsForm[key],
      } as Partial<WalletSettings>)
    );
    syncSettingsForm();
    selectDefaultNetworkAndAccount();
  } catch (err) {
    state.value = {
      ...state.value,
      settings: previousSettings,
    };
    syncSettingsForm();
    selectDefaultNetworkAndAccount();
    setError(err);
  } finally {
    busy.value = false;
  }
}

async function createNewWallet(): Promise<void> {
  await run(async () => {
    const result = await serviceCall<
      { seedGroupId?: string; chains: Chain[]; name?: string },
      CreateAccountResult
    >('createAccount', {
      seedGroupId: selectedSeedGroupId.value || undefined,
      chains: ['ethereum', 'solana'] satisfies Chain[],
      name: addForm.accountName || undefined,
    });
    generatedMnemonic.value = result.mnemonic ?? '';
    state.value = result.state;
    selectedSeedGroupId.value = result.seedGroupId;
    mnemonicForm.mnemonic = '';
    await refresh();
    await refreshSelectedBalances();
    activeTab.value = 'home';
    setResult('New account created.');
  });
}

async function importMnemonic(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall('importMnemonic', {
      mnemonic: mnemonicForm.mnemonic,
      chains: ['ethereum', 'solana'] satisfies Chain[],
      name: addForm.accountName || undefined,
      walletName: addForm.accountName || undefined,
    });
    generatedMnemonic.value = '';
    mnemonicForm.mnemonic = '';
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
  const key = balanceKey(accountId, tokenId, selectedNetworkKey.value);
  const result = await serviceCall<
    { accountId: string; networkKey?: string; tokenId?: string },
    BalanceResult
  >('getBalance', {
    accountId,
    networkKey: selectedNetworkKey.value,
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
    const key = balanceKey(account.id, tokenId, selectedNetworkKey.value);
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
      { accountId: string; networkKey?: string; to: string; amount: string; tokenId?: string; passphrase?: string },
      TransferResult
    >('transfer', {
      accountId: selectedAccountId.value,
      networkKey: selectedNetworkKey.value,
      to: transferForm.to,
      amount: transferForm.amount,
      tokenId: selectedTokenId.value || undefined,
      passphrase,
    });
    lastTransfer.value = result;
    await refresh();
    await refreshSelectedBalances();
    if (result.status === 'pending') {
      pollPendingTransfer(result.accountId, result.signature);
    }
    setResult(`Transfer submitted: ${result.signature}`);
  });
}

function stopPendingTransferPoll(): void {
  if (transferStatusRefreshTimer !== undefined) {
    window.clearTimeout(transferStatusRefreshTimer);
    transferStatusRefreshTimer = undefined;
  }
}

function pollPendingTransfer(accountId: string, signature: string): void {
  stopPendingTransferPoll();
  const startedAt = Date.now();
  const tick = async () => {
    try {
      await refresh();
      const entry = (state.value.history ?? []).find(item => (
        item.accountId === accountId && item.signature === signature
      ));
      if (!entry || historyStatus(entry) !== 'pending' || Date.now() - startedAt > 130000) {
        await refreshSelectedBalances();
        stopPendingTransferPoll();
        return;
      }
    } catch (err) {
      setError(err);
      stopPendingTransferPoll();
      return;
    }
    transferStatusRefreshTimer = window.setTimeout(tick, 2000);
  };
  transferStatusRefreshTimer = window.setTimeout(tick, 2000);
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

async function revealBackupPhrase(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  const passphrase = await requestWalletPassword(
    'Show Seed Phrase',
    'Show phrase'
  );
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
    backupDialog.title = 'Backup Phrase';
    backupDialog.label = 'Recovery phrase';
    backupDialog.value = result.mnemonic ?? '';
    backupDialog.path = result.derivationPath ?? '';
    backupDialog.copyLabel = 'Copy phrase';
    backupDialog.open = true;
    setResult('');
  });
}

async function revealPrivateKey(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  const passphrase = await requestWalletPassword('Show Private Key', 'Show key');
  if (!passphrase) {
    return;
  }
  await run(async () => {
    const result = await serviceCall<
      { accountId: string; passphrase: string },
      RevealAccountPrivateKeyResult
    >('revealAccountPrivateKey', {
      accountId: selectedAccountId.value,
      passphrase,
    });
    backupDialog.title = 'Private Key';
    backupDialog.label = result.chain === 'ethereum' ? 'Ethereum private key' : 'Solana 32-byte seed';
    backupDialog.value = result.privateKey;
    backupDialog.path = '';
    backupDialog.copyLabel = 'Copy key';
    backupDialog.open = true;
    setResult('');
  });
}

function closeBackupDialog(): void {
  backupDialog.open = false;
  backupDialog.title = '';
  backupDialog.label = '';
  backupDialog.value = '';
  backupDialog.path = '';
  backupDialog.copyLabel = '';
}

async function changePassphrase(): Promise<void> {
  await run(async () => {
    if (passwordForm.newPassphrase !== passwordForm.confirmPassphrase) {
      throw new Error('New wallet passwords do not match.');
    }
    if (passwordForm.newPassphrase.length < 4) {
      throw new Error('New wallet password must be at least 4 characters.');
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
    selectedSeedGroupId.value = '';
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

async function copy(text: string | undefined): Promise<void> {
  if (!text) {
    return;
  }
  const errors: unknown[] = [];

  try {
    if (w3n.shell?.clipboard?.writeText) {
      await w3n.shell.clipboard.writeText(text, 'clipboard');
      setResult('Copied.');
      return;
    }
  } catch (err) {
    errors.push(err);
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setResult('Copied.');
      return;
    }
  } catch (err) {
    errors.push(err);
  }

  try {
    copyFallbackText.value = text;
    await nextTick();
    const field = copyFallbackField.value;
    if (!field) {
      throw new Error('Clipboard fallback field is unavailable.');
    }
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    field.setSelectionRange(0, 0);
    field.blur();
    if (!copied) {
      throw new Error('Clipboard fallback copy command failed.');
    }
    setResult('Copied.');
  } catch (err) {
    const detail = [...errors, err].map(stableDetails).join('\n\n');
    setError(new Error(`Copy to clipboard failed.${detail ? `\n\n${detail}` : ''}`));
  }
}

async function openExternalUrl(url: string | undefined): Promise<void> {
  if (!url) {
    return;
  }
  await run(async () => {
    await w3n.shell?.openURL?.(url);
  });
}

function historyStatus(entry: TransactionHistoryEntry): TransactionStatus {
  return entry.status ?? 'not_included';
}

function toggleHistoryEntry(entryId: string): void {
  expandedHistoryId.value = expandedHistoryId.value === entryId ? '' : entryId;
}

function setHistoryPage(nextPage: number): void {
  historyPage.value = Math.min(Math.max(1, nextPage), historyPageCount.value);
}

watch(() => state.value.settings, syncSettingsForm, { deep: true });
watch(() => status.value.unlocked, unlocked => {
  if (unlocked && approvalDialog.open) {
    approvalDialog.waitingForUnlock = false;
  }
});
watch(() => state.value.settings.enableDevelopmentNetworks, () => {
  selectDefaultNetworkAndAccount();
});
watch(selectedNetworkKey, () => {
  selectedTokenId.value = '';
  if (!accountsForNetwork.value.some(account => account.id === selectedAccountId.value)) {
    selectedAccountId.value = accountsForNetwork.value[0]?.id ?? '';
  }
});
watch(selectedAccountId, () => {
  selectedTokenId.value = '';
  expandedHistoryId.value = '';
  closeBackupDialog();
  void refreshSelectedBalances();
});
watch([selectedNetworkKey, historyPageSize], () => {
  historyPage.value = 1;
  expandedHistoryId.value = '';
});
watch(historyForSelectedAccount, () => {
  setHistoryPage(historyPage.value);
});
watch(() => compatibleTokens.value.map(token => token.id).join(','), () => {
  if (selectedTokenId.value && !compatibleTokens.value.some(token => token.id === selectedTokenId.value)) {
    selectedTokenId.value = '';
  }
  void refreshSelectedBalances();
});

onMounted(async () => {
  exposeExternalWalletService();
  await run(loadInitialStateWithoutRpc);
  await run(refresh);
  void refreshSelectedBalances();
  balanceRefreshTimer = window.setInterval(() => {
    void refreshSelectedBalances();
  }, 30000);
});

onUnmounted(() => {
  if (approvalDialogResolve) {
    approvalDialogResolve(null);
  }
  if (balanceRefreshTimer !== undefined) {
    window.clearInterval(balanceRefreshTimer);
  }
  stopPendingTransferPoll();
});
</script>

<template>
  <main class="shell">
    <textarea
      ref="copyFallbackField"
      v-model="copyFallbackText"
      class="clipboard-fallback"
      aria-hidden="true"
      tabindex="-1"
      readonly
    ></textarea>
    <VaultGate
      v-if="!status.unlocked"
      :status="status"
      :vault-form="vaultForm"
      :busy="busy"
      :can-submit-vault="canSubmitVault"
      :vault-password-too-short="vaultPasswordTooShort"
      :vault-confirm-mismatch="vaultConfirmMismatch"
      :approval-open="approvalDialog.open"
      :error-message="errorMessage"
      :error-details="errorDetails"
      @submit="unlockOrCreateVault"
      @reject-external="rejectExternalApproval"
      @clear-error="clearError"
    />

    <template v-else>
      <WalletHeader :busy="busy" @lock="lock" />
      <WalletTabBar v-model:active-tab="activeTab" />

      <AddAccountTab
        v-if="activeTab === 'create'"
        v-model:selected-seed-group-id="selectedSeedGroupId"
        :state="state"
        :busy="busy"
        :add-form="addForm"
        :mnemonic-form="mnemonicForm"
        :private-key-form="privateKeyForm"
        :generated-mnemonic="generatedMnemonic"
        @create="createNewWallet"
        @import-mnemonic="importMnemonic"
        @import-private-key="importPrivateKey"
        @copy="copy"
      />

      <HomeTab
        v-else-if="activeTab === 'home'"
        v-model:selected-network-key="selectedNetworkKey"
        v-model:selected-account-id="selectedAccountId"
        v-model:selected-token-id="selectedTokenId"
        :available-networks="availableNetworks"
        :accounts-for-network="accountsForNetwork"
        :selected-account="selectedAccount"
        :native-balance="nativeBalance"
        :tracked-token-rows="trackedTokenRows"
        :balances-loading="balancesLoading"
        :busy="busy"
        :selected-asset-symbol="selectedAssetSymbol"
        :selected-network="selectedNetwork"
        :compatible-tokens="compatibleTokens"
        :transfer-form="transferForm"
        :sign-form="signForm"
        :last-transfer="lastTransfer"
        :last-signature="lastSignature"
        :can-reveal-backup-phrase="canRevealBackupPhrase"
        @copy="copy"
        @refresh-selected-balances="refreshSelectedBalances"
        @transfer="transfer"
        @open-external-url="openExternalUrl"
        @sign-message="signMessage"
        @reveal-backup-phrase="revealBackupPhrase"
        @reveal-private-key="revealPrivateKey"
      />

      <HistoryTab
        v-else-if="activeTab === 'history'"
        :history-for-selected-account="historyForSelectedAccount"
        :paged-history="pagedHistory"
        :history-page="historyPage"
        :history-page-size="historyPageSize"
        :history-page-size-options="historyPageSizeOptions"
        :history-page-count="historyPageCount"
        :expanded-history-id="expandedHistoryId"
        :selected-account="selectedAccount"
        @update:history-page-size="historyPageSize = $event"
        @set-history-page="setHistoryPage"
        @toggle="toggleHistoryEntry"
        @copy="copy"
        @open-external-url="openExternalUrl"
      />

      <SettingsTab
        v-else
        :busy="busy"
        :settings-form="settingsForm"
        :password-form="passwordForm"
        :reset-form="resetForm"
        :new-password-too-short="newPasswordTooShort"
        :password-confirm-mismatch="passwordConfirmMismatch"
        @update-setting="updateSetting"
        @change-passphrase="changePassphrase"
        @reset-vault="resetVault"
      />

      <ErrorNotice
        v-if="errorMessage"
        :message="errorMessage"
        :details="errorDetails"
        @close="clearError"
      />

      <ApprovalDialog
        :open="approvalDialog.open && status.unlocked"
        :busy="busy"
        :title="approvalDialog.title"
        :action-label="approvalDialog.actionLabel"
        :rows="approvalRows"
        :payload-text="approvalPayloadPreview"
        @reject="rejectExternalApproval"
        @approve="approveExternalApproval"
      />

      <PasswordDialog
        v-model:passphrase="passwordDialog.passphrase"
        :open="passwordDialog.open"
        :busy="busy"
        :title="passwordDialog.title"
        :action-label="passwordDialog.actionLabel"
        @close="closePasswordDialog"
        @submit="submitPasswordDialog"
      />

      <BackupDialog
        :open="backupDialog.open"
        :busy="busy"
        :title="backupDialog.title"
        :label="backupDialog.label"
        :value="backupDialog.value"
        :path="backupDialog.path"
        :copy-label="backupDialog.copyLabel"
        @close="closeBackupDialog"
        @copy="copy"
      />
    </template>
  </main>
</template>
