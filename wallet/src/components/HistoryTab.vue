<script setup lang="ts">
import { shortAddress } from '@/lib/format';
import type { TransactionHistoryEntry, TransactionStatus, WalletAccount } from '@/lib/types';

defineProps<{
  historyForSelectedAccount: TransactionHistoryEntry[];
  pagedHistory: TransactionHistoryEntry[];
  historyPage: number;
  historyPageSize: number;
  historyPageSizeOptions: readonly number[];
  historyPageCount: number;
  expandedHistoryId: string;
  selectedAccount?: WalletAccount;
}>();

const emit = defineEmits<{
  'update:historyPageSize': [size: number];
  setHistoryPage: [page: number];
  toggle: [entryId: string];
  copy: [text: string];
  openExternalUrl: [url: string];
}>();

function formatHistoryTimestamp(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return iso;
  }
  return new Date(time).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function historyStatus(entry: TransactionHistoryEntry): TransactionStatus {
  return entry.status ?? 'not_included';
}

function historyValue(entry: TransactionHistoryEntry): string {
  return entry.value ?? `${entry.amount} ${entry.assetSymbol}`;
}

function historyHash(entry: TransactionHistoryEntry): string {
  return entry.txHash ?? entry.signature;
}
</script>

<template>
  <section class="tab-surface history-panel">
    <div class="history-header">
      <div class="history-controls" v-if="historyForSelectedAccount.length">
        <label aria-label="Rows per page">
          <select :value="historyPageSize" @change="emit('update:historyPageSize', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="size in historyPageSizeOptions" :key="size" :value="size">
              {{ size }}
            </option>
          </select>
        </label>
        <div class="history-pages" aria-label="History pagination">
          <button class="icon-action" :disabled="historyPage === 1" aria-label="Previous page" @click="emit('setHistoryPage', historyPage - 1)">
            ‹
          </button>
          <span>{{ historyPage }} / {{ historyPageCount }}</span>
          <button class="icon-action" :disabled="historyPage === historyPageCount" aria-label="Next page" @click="emit('setHistoryPage', historyPage + 1)">
            ›
          </button>
        </div>
      </div>
    </div>
    <div v-if="historyForSelectedAccount.length" class="history-list">
      <article
        v-for="entry in pagedHistory"
        :key="entry.id"
        class="history-row"
        :data-expanded="expandedHistoryId === entry.id"
        :data-status="historyStatus(entry)"
      >
        <button class="history-summary" type="button" @click="emit('toggle', entry.id)">
          <span class="history-status">
            <svg v-if="historyStatus(entry) === 'success'" aria-hidden="true" viewBox="0 0 24 24">
              <path d="m5 12 5 5L20 7" />
            </svg>
            <svg v-else-if="historyStatus(entry) === 'failed'" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12" />
              <path d="M18 6 6 18" />
            </svg>
            <svg v-else aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="6" />
            </svg>
          </span>
          <span class="history-time">{{ formatHistoryTimestamp(entry.createdAt) }}</span>
          <span class="history-main">
            <strong>{{ historyValue(entry) }}</strong>
            <small>{{ shortAddress(entry.to) }}</small>
          </span>
          <code>{{ shortAddress(historyHash(entry)) }}</code>
        </button>
        <div v-if="expandedHistoryId === entry.id" class="history-details">
          <dl>
            <div>
              <dt>From</dt>
              <dd>
                <code>{{ entry.from ?? selectedAccount?.address ?? '' }}</code>
                <button class="icon-action" :disabled="!(entry.from ?? selectedAccount?.address)" title="Copy from" aria-label="Copy from" @click="emit('copy', entry.from ?? selectedAccount?.address ?? '')">
                  ⧉
                </button>
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>
                <code>{{ entry.to }}</code>
                <button class="icon-action" title="Copy to" aria-label="Copy to" @click="emit('copy', entry.to)">
                  ⧉
                </button>
              </dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>
                <code>{{ historyValue(entry) }}</code>
                <button class="icon-action" title="Copy value" aria-label="Copy value" @click="emit('copy', historyValue(entry))">
                  ⧉
                </button>
              </dd>
            </div>
            <div>
              <dt>Tx hash</dt>
              <dd>
                <code>{{ historyHash(entry) }}</code>
                <button class="icon-action" title="Copy transaction hash" aria-label="Copy transaction hash" @click="emit('copy', historyHash(entry))">
                  ⧉
                </button>
              </dd>
            </div>
          </dl>
          <button v-if="entry.explorerUrl" class="btn btn--secondary explorer-button" @click="emit('openExternalUrl', entry.explorerUrl)">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M14 4h6v6" />
              <path d="M10 14 20 4" />
              <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
            </svg>
            <span>Open explorer</span>
          </button>
        </div>
      </article>
    </div>
    <p v-else class="empty">No transactions recorded for the selected account.</p>
  </section>
</template>
