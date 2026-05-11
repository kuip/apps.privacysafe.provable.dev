<script setup lang="ts">
import { computed, ref } from 'vue';

type Chain = 'ethereum' | 'solana';

type WalletAccount = {
  id: string;
  chain: Chain;
  name: string;
  address: string;
};

type WalletPublicState = {
  accounts: WalletAccount[];
};

type SignMessageResult = {
  accountId: string;
  chain: Chain;
  address: string;
  signature: string;
};

type TransferResult = {
  accountId: string;
  chain: Chain;
  signature: string;
  status: 'pending' | 'success' | 'failed' | 'not_included';
  explorerUrl?: string;
};

const WALLET_APP = 'wallet.app.provable.dev';
const WALLET_SERVICE = 'WalletSigner';

const busy = ref(false);
const error = ref('');
const result = ref('');
const accounts = ref<WalletAccount[]>([]);
const selectedAccountId = ref('');
const message = ref('Hello from Wallet External Test');
const hoodiTo = ref('');
const hoodiAmount = ref('0.001');

const selectedAccount = computed(() => (
  accounts.value.find(account => account.id === selectedAccountId.value)
));
const selectedEthereumAccount = computed(() => (
  selectedAccount.value?.chain === 'ethereum' ? selectedAccount.value : undefined
));

function encodeJson(value: unknown): web3n.rpc.PassedDatum {
  return { bytes: new TextEncoder().encode(JSON.stringify(value ?? null)) };
}

function decodeJson<T>(datum: web3n.rpc.PassedDatum | undefined): T {
  if (!datum?.bytes) {
    return undefined as T;
  }
  return JSON.parse(new TextDecoder().decode(datum.bytes)) as T;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || err.message;
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

async function callWallet<TRequest, TResponse>(method: string, payload: TRequest): Promise<TResponse> {
  const connection = await w3n.rpc!.otherAppsRPC!(WALLET_APP, WALLET_SERVICE);
  try {
    const reply = await connection.makeRequestReplyCall(method, encodeJson(payload));
    return decodeJson<TResponse>(reply);
  } finally {
    await connection.close();
  }
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    error.value = formatError(err);
    await w3n.log?.('error', 'Wallet external test failed', err);
  } finally {
    busy.value = false;
  }
}

async function loadAccounts(): Promise<void> {
  await run(async () => {
    const state = await callWallet<void, WalletPublicState>('getPublicState', undefined as void);
    accounts.value = state.accounts ?? [];
    selectedAccountId.value = accounts.value[0]?.id ?? '';
    result.value = JSON.stringify(state, null, 2);
  });
}

async function signMessage(): Promise<void> {
  if (!selectedAccountId.value) {
    error.value = 'Select a wallet account first.';
    return;
  }

  await run(async () => {
    const signature = await callWallet<{ accountId: string; message: string }, SignMessageResult>('signMessage', {
      accountId: selectedAccountId.value,
      message: message.value,
    });
    result.value = JSON.stringify(signature, null, 2);
  });
}

async function sendHoodiNativeTransfer(): Promise<void> {
  if (!selectedEthereumAccount.value) {
    error.value = 'Select an Ethereum wallet account first.';
    return;
  }
  if (!hoodiTo.value || !hoodiAmount.value) {
    error.value = 'Recipient and amount are required.';
    return;
  }

  await run(async () => {
    const transfer = await callWallet<{
      accountId: string;
      networkKey: string;
      to: string;
      amount: string;
    }, TransferResult>('transfer', {
      accountId: selectedEthereumAccount.value!.id,
      networkKey: 'ethereum:hoodi',
      to: hoodiTo.value,
      amount: hoodiAmount.value,
    });
    result.value = JSON.stringify(transfer, null, 2);
  });
}

async function testForbiddenImport(): Promise<void> {
  await run(async () => {
    const reply = await callWallet('importMnemonic', {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      chains: ['ethereum', 'solana'],
    });
    result.value = JSON.stringify(reply, null, 2);
  });
}
</script>

<template>
  <main class="app-shell">
    <header class="header">
      <img alt="Wallet test" src="/logo.svg" />
      <div>
        <h1>Wallet External Test</h1>
        <p>Calls WalletSigner as a separate PrivacySafe app.</p>
      </div>
    </header>

    <section class="panel">
      <div class="panel-header">
        <h2>Wallet Accounts</h2>
        <button :disabled="busy" @click="loadAccounts">Load accounts</button>
      </div>
      <label>
        <span>Account</span>
        <select v-model="selectedAccountId" :disabled="busy || accounts.length === 0">
          <option value="">No account loaded</option>
          <option v-for="account in accounts" :key="account.id" :value="account.id">
            {{ account.name }} - {{ account.chain }} - {{ account.address }}
          </option>
        </select>
      </label>
      <p v-if="selectedAccount" class="muted">{{ selectedAccount.address }}</p>
    </section>

    <section class="panel">
      <h2>Sign Message</h2>
      <label>
        <span>Message</span>
        <textarea v-model="message" rows="5" spellcheck="false"></textarea>
      </label>
      <button :disabled="busy || !selectedAccountId || !message" @click="signMessage">
        Request wallet signature
      </button>
    </section>

    <section class="panel">
      <h2>Send Hoodi ETH</h2>
      <p class="muted">Uses WalletSigner.transfer with networkKey ethereum:hoodi.</p>
      <label>
        <span>Recipient</span>
        <input v-model.trim="hoodiTo" autocomplete="off" placeholder="0x..." />
      </label>
      <label>
        <span>Amount</span>
        <input v-model.trim="hoodiAmount" autocomplete="off" inputmode="decimal" />
      </label>
      <button
        :disabled="busy || !selectedEthereumAccount || !hoodiTo || !hoodiAmount"
        @click="sendHoodiNativeTransfer"
      >
        Request Hoodi transfer
      </button>
    </section>

    <section class="panel">
      <h2>Permission Check</h2>
      <p class="muted">This should fail because external apps cannot import secrets.</p>
      <button class="secondary" :disabled="busy" @click="testForbiddenImport">
        Try forbidden importMnemonic
      </button>
    </section>

    <section v-if="error" class="notice notice-error">
      <strong>Error</strong>
      <pre>{{ error }}</pre>
    </section>

    <section v-if="result" class="notice">
      <strong>Result</strong>
      <pre>{{ result }}</pre>
    </section>
  </main>
</template>
