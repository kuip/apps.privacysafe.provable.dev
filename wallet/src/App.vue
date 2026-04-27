<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { WALLET_SERVICE_NAME } from '@/lib/constants';
import { callThisAppService } from '@/lib/json-rpc';
import { shortAddress } from '@/lib/format';
import type {
  BalanceResult,
  Chain,
  TokenConfig,
  TransferResult,
  WalletAccount,
  WalletPublicState,
  WalletStatus,
} from '@/lib/types';

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
  updatedAt: '',
});
const selectedAccountId = ref('');
const selectedTokenId = ref('');
const busy = ref(false);
const message = ref('');
const error = ref('');
const generatedMnemonic = ref('');
const balance = ref<BalanceResult | null>(null);
const lastTransfer = ref<TransferResult | null>(null);
const lastSignature = ref('');

const unlockForm = reactive({
  passphrase: '',
});
const mnemonicForm = reactive({
  mnemonic: '',
  ethereum: true,
  solana: true,
  name: '',
});
const privateKeyForm = reactive({
  chain: 'ethereum' as Chain,
  privateKey: '',
  name: '',
});
const transferForm = reactive({
  to: '',
  amount: '',
});
const signForm = reactive({
  message: '',
});

const selectedAccount = computed(() => (
  state.value.accounts.find(account => account.id === selectedAccountId.value)
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

function setResult(text: string): void {
  message.value = text;
  error.value = '';
}

function setError(err: unknown): void {
  error.value = err instanceof Error ? err.message : String(err);
  message.value = '';
}

async function serviceCall<TRequest, TResponse>(method: string, payload: TRequest): Promise<TResponse> {
  return callThisAppService<TRequest, TResponse>(WALLET_SERVICE_NAME, method, payload);
}

async function refresh(): Promise<void> {
  status.value = await serviceCall<void, WalletStatus>('status', undefined as void);
  state.value = await serviceCall<void, WalletPublicState>('getPublicState', undefined as void);
  if (!selectedAccountId.value && state.value.accounts[0]) {
    selectedAccountId.value = state.value.accounts[0].id;
  }
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (err) {
    setError(err);
  } finally {
    busy.value = false;
  }
}

async function unlock(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall('unlock', { passphrase: unlockForm.passphrase });
    await refresh();
    setResult(status.value.exists ? 'Wallet unlocked.' : 'Wallet created.');
  });
}

async function lock(): Promise<void> {
  await run(async () => {
    status.value = await serviceCall<void, WalletStatus>('lock', undefined as void);
    setResult('Wallet locked.');
  });
}

async function createMnemonic(): Promise<void> {
  await run(async () => {
    const result = await serviceCall<void, { mnemonic: string }>('createMnemonic', undefined as void);
    generatedMnemonic.value = result.mnemonic;
    mnemonicForm.mnemonic = result.mnemonic;
    setResult('Mnemonic generated. Store it before importing.');
  });
}

async function importMnemonic(): Promise<void> {
  await run(async () => {
    const chains: Chain[] = [];
    if (mnemonicForm.ethereum) {
      chains.push('ethereum');
    }
    if (mnemonicForm.solana) {
      chains.push('solana');
    }
    state.value = await serviceCall('importMnemonic', {
      mnemonic: mnemonicForm.mnemonic,
      chains,
      name: mnemonicForm.name || undefined,
    });
    await refresh();
    setResult('Mnemonic account imported.');
  });
}

async function importPrivateKey(): Promise<void> {
  await run(async () => {
    state.value = await serviceCall('importPrivateKey', {
      chain: privateKeyForm.chain,
      privateKey: privateKeyForm.privateKey,
      name: privateKeyForm.name || undefined,
    });
    privateKeyForm.privateKey = '';
    await refresh();
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
      { accountId: string; to: string; amount: string; tokenId?: string },
      TransferResult
    >('transfer', {
      accountId: selectedAccountId.value,
      to: transferForm.to,
      amount: transferForm.amount,
      tokenId: selectedTokenId.value || undefined,
    });
    lastTransfer.value = result;
    setResult(`Transfer submitted: ${result.signature}`);
  });
}

async function signMessage(): Promise<void> {
  if (!selectedAccountId.value) {
    return;
  }
  await run(async () => {
    const result = await serviceCall('signMessage', {
      accountId: selectedAccountId.value,
      message: signForm.message,
    });
    lastSignature.value = JSON.stringify(result, null, 2);
    setResult('Message signed.');
  });
}

async function copy(text: string): Promise<void> {
  await navigator.clipboard?.writeText(text);
  setResult('Copied.');
}

onMounted(async () => {
  await run(refresh);
});
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <img alt="Wallet" class="brand__logo" src="/logo.svg" />
        <div>
          <h1>Wallet</h1>
          <p>Ethereum and Solana keys stay inside this PrivacySafe app.</p>
        </div>
      </div>
      <div class="status-pill" :data-unlocked="status.unlocked">
        {{ status.unlocked ? 'Unlocked' : 'Locked' }}
      </div>
    </header>

    <section class="grid grid--setup">
      <article class="panel panel--unlock">
        <div class="panel__header">
          <h2>Vault</h2>
          <button v-if="status.unlocked" class="btn btn--secondary" :disabled="busy" @click="lock">
            Lock
          </button>
        </div>

        <div v-if="!status.unlocked" class="form-stack">
          <label>
            <span>Wallet passphrase</span>
            <input
              v-model="unlockForm.passphrase"
              autocomplete="current-password"
              type="password"
              @keyup.enter="unlock"
            />
          </label>
          <button class="btn btn--primary" :disabled="busy || !unlockForm.passphrase" @click="unlock">
            {{ status.exists ? 'Unlock wallet' : 'Create vault' }}
          </button>
        </div>

        <div v-else class="vault-summary">
          <strong>{{ state.accounts.length }}</strong>
          <span>{{ state.accounts.length === 1 ? 'account' : 'accounts' }}</span>
        </div>
      </article>

      <article class="panel">
        <div class="panel__header">
          <h2>Create</h2>
          <button class="btn btn--secondary" :disabled="busy" @click="createMnemonic">
            Generate mnemonic
          </button>
        </div>
        <textarea
          v-model.trim="mnemonicForm.mnemonic"
          rows="3"
          placeholder="BIP-39 mnemonic"
          spellcheck="false"
        />
        <div class="check-row">
          <label class="check">
            <input v-model="mnemonicForm.ethereum" type="checkbox" />
            <span>Ethereum</span>
          </label>
          <label class="check">
            <input v-model="mnemonicForm.solana" type="checkbox" />
            <span>Solana</span>
          </label>
        </div>
        <input v-model.trim="mnemonicForm.name" autocomplete="off" placeholder="Account name" />
        <button
          class="btn btn--primary"
          :disabled="busy || !status.unlocked || !mnemonicForm.mnemonic"
          @click="importMnemonic"
        >
          Import mnemonic
        </button>
      </article>

      <article class="panel">
        <div class="panel__header">
          <h2>Import Key</h2>
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
        <input v-model.trim="privateKeyForm.name" autocomplete="off" placeholder="Account name" />
        <button
          class="btn btn--primary"
          :disabled="busy || !status.unlocked || !privateKeyForm.privateKey"
          @click="importPrivateKey"
        >
          Import private key
        </button>
      </article>
    </section>

    <section class="wallet-grid">
      <aside class="panel account-list">
        <div class="panel__header">
          <h2>Accounts</h2>
          <button class="icon-btn" :disabled="busy" title="Refresh" @click="refresh">R</button>
        </div>
        <button
          v-for="account in state.accounts"
          :key="account.id"
          class="account-row"
          :data-active="account.id === selectedAccountId"
          @click="selectedAccountId = account.id; selectedTokenId = ''; balance = null"
        >
          <span class="chain-mark">{{ account.chain === 'ethereum' ? 'ETH' : 'SOL' }}</span>
          <span>
            <strong>{{ account.name }}</strong>
            <small>{{ shortAddress(account.address) }}</small>
          </span>
        </button>
        <p v-if="state.accounts.length === 0" class="empty">Unlock the vault and import an account.</p>
      </aside>

      <section class="panel workspace">
        <div class="panel__header">
          <div>
            <h2>{{ selectedAccount?.name || 'No account selected' }}</h2>
            <p v-if="selectedAccount" class="address-line">
              {{ selectedAccount.address }}
            </p>
          </div>
          <button
            v-if="selectedAccount"
            class="btn btn--secondary"
            :disabled="busy"
            @click="copy(selectedAccount.address)"
          >
            Copy address
          </button>
        </div>

        <div class="asset-row">
          <select v-model="selectedTokenId">
            <option value="">{{ selectedAccount?.chain === 'ethereum' ? 'ETH' : 'SOL' }}</option>
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
            <button
              class="btn btn--primary"
              :disabled="busy || !status.unlocked || !selectedAccount || !transferForm.to || !transferForm.amount"
              @click="transfer"
            >
              Send
            </button>
            <a v-if="lastTransfer?.explorerUrl" class="tx-link" :href="lastTransfer.explorerUrl">
              {{ shortAddress(lastTransfer.signature) }}
            </a>
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
              :disabled="busy || !status.unlocked || !selectedAccount || !signForm.message"
              @click="signMessage"
            >
              Sign
            </button>
            <pre v-if="lastSignature">{{ lastSignature }}</pre>
          </article>
        </div>
      </section>
    </section>

    <footer class="status-bar" :data-error="!!error">
      {{ error || message || 'Wallet signer service is ready.' }}
    </footer>
  </main>
</template>
