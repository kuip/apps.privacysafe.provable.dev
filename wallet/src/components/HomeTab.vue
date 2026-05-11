<script setup lang="ts">
import { shortAddress } from '@/lib/format';
import type { BalanceResult, NetworkConfig, TokenConfig, TransferResult, WalletAccount } from '@/lib/types';

defineProps<{
  availableNetworks: NetworkConfig[];
  selectedNetworkKey: string;
  accountsForNetwork: WalletAccount[];
  selectedAccountId: string;
  selectedAccount?: WalletAccount;
  nativeBalance?: BalanceResult;
  trackedTokenRows: Array<{
    token: TokenConfig;
    balance?: BalanceResult;
    error?: string;
  }>;
  balancesLoading: boolean;
  busy: boolean;
  selectedAssetSymbol: string;
  selectedNetwork?: NetworkConfig;
  compatibleTokens: TokenConfig[];
  selectedTokenId: string;
  transferForm: {
    to: string;
    amount: string;
  };
  signForm: {
    message: string;
  };
  lastTransfer: TransferResult | null;
  lastSignature: string;
  canRevealBackupPhrase: boolean;
}>();

const emit = defineEmits<{
  'update:selectedNetworkKey': [networkKey: string];
  'update:selectedAccountId': [accountId: string];
  'update:selectedTokenId': [tokenId: string];
  copy: [text: string];
  refreshSelectedBalances: [];
  transfer: [];
  openExternalUrl: [url: string];
  signMessage: [];
  revealBackupPhrase: [];
  revealPrivateKey: [];
}>();

function balanceText(result: BalanceResult | undefined): string {
  return result ? `${result.formatted} ${result.symbol}` : 'Loading';
}
</script>

<template>
  <section class="tab-surface home-grid">
    <div class="home-selectors">
      <label aria-label="Network">
        <select :value="selectedNetworkKey" @change="emit('update:selectedNetworkKey', ($event.target as HTMLSelectElement).value)">
          <option v-for="network in availableNetworks" :key="network.key" :value="network.key">
            {{ network.name }}
          </option>
        </select>
      </label>
      <label aria-label="Account">
        <select :value="selectedAccountId" :disabled="accountsForNetwork.length === 0" @change="emit('update:selectedAccountId', ($event.target as HTMLSelectElement).value)">
          <option v-if="accountsForNetwork.length === 0" value="">No account</option>
          <option v-for="account in accountsForNetwork" :key="account.id" :value="account.id">
            {{ account.name }} - {{ shortAddress(account.address) }}
          </option>
        </select>
      </label>
    </div>

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
          @click="emit('copy', selectedAccount.address)"
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
          @click="emit('refreshSelectedBalances')"
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
          <select :value="selectedTokenId" :disabled="!selectedAccount" @change="emit('update:selectedTokenId', ($event.target as HTMLSelectElement).value)">
            <option value="">{{ selectedNetwork?.nativeSymbol || 'Native coin' }}</option>
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
          @click="emit('transfer')"
        >
          Send
        </button>
        <button v-if="lastTransfer?.explorerUrl" class="link-button tx-link" @click="emit('openExternalUrl', lastTransfer.explorerUrl)">
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
          @click="emit('signMessage')"
        >
          Sign
        </button>
        <pre v-if="lastSignature">{{ lastSignature }}</pre>
      </article>
    </div>

    <article class="panel">
      <div class="panel__header">
        <h2>Backup</h2>
        <div class="button-row">
          <button
            v-if="canRevealBackupPhrase"
            class="btn btn--danger btn--muted-danger"
            :disabled="busy || !selectedAccount"
            @click="emit('revealBackupPhrase')"
          >
            Show backup phrase
          </button>
          <button class="btn btn--danger btn--muted-danger" :disabled="busy || !selectedAccount" @click="emit('revealPrivateKey')">
            Show private key
          </button>
        </div>
      </div>
    </article>
  </section>
</template>
