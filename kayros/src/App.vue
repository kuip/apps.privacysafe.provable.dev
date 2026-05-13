<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  checkMerkleProofCompatibility,
  get_merkle_proof,
  setKayrosHost,
  verifyWithInclusion,
} from '@kuip/provable-sdk';
import { callThisAppService } from '@/lib/json-rpc';
import { KAYROS_SERVICE_NAME } from '@/lib/constants';
import type {
  ArchivedProofBundle,
  ArchivedProofListEntry,
  KayrosSettings,
  ListArchivedProofsResult,
  LookupDataItemResult,
  LookupRecordResult,
  RegisterHashResult,
  SaveMerkleProofFileResult,
} from '@/lib/types';

type TabId = 'proofs' | 'lookup' | 'register' | 'settings';
type ProofStatus = 'success' | 'failed';

interface ProofRowView extends ArchivedProofListEntry {
  expanded: boolean;
  loading: boolean;
  updating: boolean;
  verifying: boolean;
  status: ProofStatus;
  bundle: ArchivedProofBundle | null;
  note: string | null;
}

const settings = reactive<KayrosSettings>({
  kayrosHost: '',
  dataType: '',
  userKey: '',
  saveMerkleProofs: false,
});

const activeTab = ref<TabId>('proofs');
const registerHash = ref('');
const registerRawContent = ref('');
const lookupHash = ref('');
const lookupDataItem = ref('');
const busy = ref(false);
const deleteConfirmText = ref('');
const successMessage = ref('');
let successMessageTimer: number | undefined;

const registerResult = ref<RegisterHashResult | null>(null);
const registerRawResult = ref<RegisterHashResult | null>(null);
const lookupResult = ref<LookupRecordResult | null>(null);
const lookupDataItemResult = ref<LookupDataItemResult | null>(null);
const proofRows = ref<ProofRowView[]>([]);
const proofPage = ref(1);
const proofPageSize = ref(10);
const proofPageSizeOptions = [10, 20, 50] as const;
let proofsRefreshTimer: ReturnType<typeof setInterval> | undefined;

const proofPageCount = computed(() => (
  Math.max(1, Math.ceil(proofRows.value.length / proofPageSize.value))
));

const pagedProofRows = computed(() => {
  const start = (proofPage.value - 1) * proofPageSize.value;
  return proofRows.value.slice(start, start + proofPageSize.value);
});

function proofKey(entry: Pick<ArchivedProofListEntry, 'dataType' | 'contentHash'>): string {
  return `${entry.dataType}::${entry.contentHash}`;
}

function jsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function proofCurrentFilePath(row: ProofRowView): string {
  const path = row.bundle?.meta && typeof row.bundle.meta === 'object'
    ? (row.bundle.meta as { currentFilePath?: unknown }).currentFilePath
    : undefined;
  return typeof path === 'string' ? path : '';
}

function proofDataType(row: ProofRowView): string {
  return row.dataType || '';
}

function proofDataHash(row: ProofRowView): string {
  const hash = row.bundle?.proof?.content?.hash;
  return typeof hash === 'string' ? hash : row.contentHash;
}

function proofRecordHash(row: ProofRowView): string {
  const hash = row.bundle?.proof?.content?.response?.hash;
  return typeof hash === 'string' ? hash : '';
}

function rowBusy(row: ProofRowView): boolean {
  return busy.value || row.loading || row.updating || row.verifying;
}

function formatProofTimestamp(iso?: string): string {
  if (!iso) {
    return 'Unknown time';
  }
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return iso;
  }
  return new Date(time).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function setSuccess(text: string): void {
  if (successMessageTimer !== undefined) {
    window.clearTimeout(successMessageTimer);
    successMessageTimer = undefined;
  }
  successMessage.value = text;
  if (text) {
    successMessageTimer = window.setTimeout(() => {
      successMessage.value = '';
      successMessageTimer = undefined;
    }, 3500);
  }
}

async function loadSettings() {
  const loaded = await callThisAppService<void, KayrosSettings>(
    KAYROS_SERVICE_NAME,
    'getSettings',
    undefined as void,
  );
  Object.assign(settings, loaded);
}

async function saveSettings() {
  busy.value = true;
  try {
    const saved = await callThisAppService<Partial<KayrosSettings>, KayrosSettings>(
      KAYROS_SERVICE_NAME,
      'saveSettings',
      settings,
    );
    Object.assign(settings, saved);
  } finally {
    busy.value = false;
  }
}

async function saveMerkleProofsSetting() {
  busy.value = true;
  try {
    const saved = await callThisAppService<Partial<KayrosSettings>, KayrosSettings>(
      KAYROS_SERVICE_NAME,
      'saveSettings',
      {
        saveMerkleProofs: settings.saveMerkleProofs,
      },
    );
    Object.assign(settings, saved);
  } finally {
    busy.value = false;
  }
}

async function deleteKayrosData() {
  busy.value = true;
  try {
    await callThisAppService<void, { deleted: true }>(
      KAYROS_SERVICE_NAME,
      'deleteKayrosData',
      undefined as void,
    );

    deleteConfirmText.value = '';
    registerHash.value = '';
    registerRawContent.value = '';
    lookupHash.value = '';
    lookupDataItem.value = '';
    registerResult.value = null;
    registerRawResult.value = null;
    lookupResult.value = null;
    lookupDataItemResult.value = null;
    proofRows.value = [];
    proofPage.value = 1;

    await loadSettings();
    if (activeTab.value === 'proofs') {
      await loadProofs();
    }
    setSuccess('Kayros data deleted.');
  } finally {
    busy.value = false;
  }
}

async function notarizeCurrentHash() {
  busy.value = true;
  registerResult.value = null;
  try {
    registerResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'registerHash',
      {
        hash: registerHash.value,
      },
    );
  } finally {
    busy.value = false;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function notarizeRawContent() {
  busy.value = true;
  registerRawResult.value = null;
  try {
    const hash = await sha256Hex(registerRawContent.value);
    registerRawResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'registerHash',
      {
        hash,
      },
    );
  } finally {
    busy.value = false;
  }
}

async function lookupCurrentHash() {
  busy.value = true;
  lookupResult.value = null;
  try {
    lookupResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'lookupRecord',
      {
        hash: lookupHash.value,
      },
    );
  } finally {
    busy.value = false;
  }
}

async function lookupCurrentDataItem() {
  busy.value = true;
  lookupDataItemResult.value = null;
  try {
    lookupDataItemResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'lookupDataItem',
      {
        dataItem: lookupDataItem.value,
      },
    );
  } finally {
    busy.value = false;
  }
}

async function loadProofs() {
  busy.value = true;
  try {
    const result = await callThisAppService<void, ListArchivedProofsResult>(
      KAYROS_SERVICE_NAME,
      'listProofs',
      undefined as void,
    );
    const existingRows = new Map(proofRows.value.map(row => [proofKey(row), row]));
    const nextRows = result.entries.map(entry => {
      const existing = existingRows.get(proofKey(entry));
      const structureChanged = !!existing && (
        existing.hasProof !== entry.hasProof
        || existing.hasMeta !== entry.hasMeta
        || existing.hasMerkleProof !== entry.hasMerkleProof
      );
      return {
        ...entry,
        expanded: existing?.expanded ?? false,
        loading: false,
        updating: false,
        verifying: false,
        status: existing?.status ?? 'success',
        bundle: structureChanged ? null : (existing?.bundle ?? null),
        note: existing?.note ?? null,
      };
    });
    proofRows.value = nextRows;
    proofPage.value = Math.min(proofPage.value, Math.max(1, Math.ceil(proofRows.value.length / proofPageSize.value)));

    for (const row of nextRows) {
      if (row.expanded && !row.bundle && !row.loading) {
        void loadProofBundle(row);
      }
    }
  } finally {
    busy.value = false;
  }
}

function stopProofsAutoRefresh() {
  if (proofsRefreshTimer) {
    clearInterval(proofsRefreshTimer);
    proofsRefreshTimer = undefined;
  }
}

async function startProofsAutoRefresh() {
  stopProofsAutoRefresh();
  await loadProofs();
  proofsRefreshTimer = setInterval(() => {
    if (activeTab.value === 'proofs' && !busy.value) {
      void loadProofs();
    }
  }, 5000);
}

function setProofPage(page: number) {
  proofPage.value = Math.min(Math.max(1, page), proofPageCount.value);
}

watch(proofPageSize, () => {
  proofPage.value = 1;
});

watch(activeTab, async tab => {
  if (tab === 'proofs') {
    await startProofsAutoRefresh();
  } else {
    stopProofsAutoRefresh();
  }
});

async function loadProofBundle(row: ProofRowView) {
  row.loading = true;
  row.note = null;
  try {
    const request = {
      dataType: row.dataType,
      contentHash: row.contentHash,
    };
    const [proof, merkleProof, meta] = await Promise.all([
      callThisAppService<typeof request, ArchivedProofBundle['proof']>(
        KAYROS_SERVICE_NAME,
        'getProofFile',
        request,
      ),
      row.hasMerkleProof
        ? callThisAppService<typeof request, ArchivedProofBundle['merkleProof']>(
          KAYROS_SERVICE_NAME,
          'getMerkleProofFile',
          request,
        )
        : Promise.resolve(undefined),
      callThisAppService<typeof request, ArchivedProofBundle['meta']>(
        KAYROS_SERVICE_NAME,
        'getProofMeta',
        request,
      ),
    ]);

    row.bundle = {
      dataType: row.dataType,
      contentHash: row.contentHash,
      proof,
      merkleProof,
      meta,
    };
  } finally {
    row.loading = false;
  }
}

async function toggleProofRow(row: ProofRowView) {
  row.expanded = !row.expanded;
  if (row.expanded && !row.bundle && !row.loading) {
    await loadProofBundle(row);
  }
}

async function copyText(value: string) {
  if (!value) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // fall through to legacy copy path
  }

  const helper = document.createElement('textarea');
  helper.value = value;
  helper.setAttribute('readonly', 'true');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  helper.style.pointerEvents = 'none';
  document.body.appendChild(helper);
  helper.focus();
  helper.select();
  document.execCommand('copy');
  document.body.removeChild(helper);
}

function triggerDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function downloadAllFiles(row: ProofRowView) {
  if (!row.bundle) {
    await loadProofBundle(row);
  }

  const bundle = row.bundle;
  if (!bundle) {
    return;
  }

  if (bundle.meta) {
    triggerDownload(`${row.contentHash}_meta.json`, jsonText(bundle.meta));
  }
  if (bundle.proof) {
    triggerDownload(`${row.contentHash}_proof.json`, jsonText(bundle.proof));
  }
  if (bundle.merkleProof !== undefined) {
    triggerDownload(`${row.contentHash}_merkle-proof.json`, jsonText(bundle.merkleProof));
  }
}

function resolveServiceApiKey(): string | undefined {
  return settings.userKey.trim() || undefined;
}

function getProofRequestParts(notaryEntry: ArchivedProofBundle['proof'] extends infer T
  ? T extends { content: infer C; metadata: infer M }
    ? C | M
    : never
  : never) {
  const request = notaryEntry?.request;
  const response = notaryEntry?.response;
  if (!request?.kayrosHost || !request?.dataType || !response?.hash || !notaryEntry?.hash) {
    throw new Error('Stored proof is missing Kayros registration data.');
  }

  return {
    kayrosHost: request.kayrosHost,
    dataType: request.dataType,
    dataItem: notaryEntry.hash,
    kayrosHash: response.hash,
  };
}

async function fetchLatestMerkleProofBundle(bundle: ArchivedProofBundle) {
  const proof = bundle.proof;
  if (!proof) {
    throw new Error('Missing archived proof file.');
  }

  const content = getProofRequestParts(proof.content);
  const metadata = getProofRequestParts(proof.metadata);
  const apiKey = resolveServiceApiKey();

  setKayrosHost(content.kayrosHost);
  const contentMerkle = await get_merkle_proof(
    {
      data_type: content.dataType,
      hash: content.kayrosHash,
    },
    { apiKey },
  );

  setKayrosHost(metadata.kayrosHost);
  const metadataMerkle = await get_merkle_proof(
    {
      data_type: metadata.dataType,
      hash: metadata.kayrosHash,
    },
    { apiKey },
  );

  return {
    version: 1,
    content: contentMerkle,
    metadata: metadataMerkle,
  };
}

async function updateProofRow(row: ProofRowView) {
  if (!row.bundle) {
    await loadProofBundle(row);
  }

  const bundle = row.bundle;
  if (!bundle?.proof) {
    row.status = 'failed';
    row.note = 'Missing archived proof file.';
    return;
  }

  row.updating = true;
  row.note = null;
  try {
    const latestMerkleProof = await fetchLatestMerkleProofBundle(bundle);
    const storedMerkleProof = bundle.merkleProof as
      | { content?: unknown; metadata?: unknown }
      | undefined;

    const incompatibilities: string[] = [];
    if (storedMerkleProof?.content) {
      const result = checkMerkleProofCompatibility(storedMerkleProof.content as never, latestMerkleProof.content);
      if (!result.compatible) {
        incompatibilities.push(`content proof incompatible (${result.mismatches[0]?.message ?? 'unknown mismatch'})`);
      }
    }
    if (storedMerkleProof?.metadata) {
      const result = checkMerkleProofCompatibility(storedMerkleProof.metadata as never, latestMerkleProof.metadata);
      if (!result.compatible) {
        incompatibilities.push(`metadata proof incompatible (${result.mismatches[0]?.message ?? 'unknown mismatch'})`);
      }
    }

    if (incompatibilities.length > 0) {
      row.status = 'failed';
      row.note = incompatibilities.join('; ');
      return;
    }

    await callThisAppService<
      { dataType: string; contentHash: string; merkleProof: unknown },
      SaveMerkleProofFileResult
    >(
      KAYROS_SERVICE_NAME,
      'saveMerkleProofFile',
      {
        dataType: row.dataType,
        contentHash: row.contentHash,
        merkleProof: latestMerkleProof,
      },
    );

    bundle.merkleProof = latestMerkleProof;
    row.hasMerkleProof = true;
    row.status = 'success';
    row.note = null;
  } catch (err) {
    row.status = 'failed';
    row.note = err instanceof Error ? err.message : String(err);
  } finally {
    row.updating = false;
  }
}

async function verifyProofRow(row: ProofRowView) {
  if (!row.bundle) {
    await loadProofBundle(row);
  }

  const bundle = row.bundle;
  if (!bundle?.proof) {
    row.status = 'failed';
    row.note = 'Missing archived proof file.';
    return;
  }

  row.verifying = true;
  row.note = null;
  try {
    const proof = bundle.proof;
    const content = getProofRequestParts(proof.content);
    const metadata = getProofRequestParts(proof.metadata);
    const apiKey = resolveServiceApiKey();

    setKayrosHost(content.kayrosHost);
    const contentVerification = await verifyWithInclusion({
      dataType: content.dataType,
      dataItem: content.dataItem,
      kayrosHash: content.kayrosHash,
      apiKey,
    });

    if (!contentVerification.valid) {
      row.status = 'failed';
      row.note = contentVerification.error ?? 'Content proof verification failed.';
      return;
    }

    setKayrosHost(metadata.kayrosHost);
    const metadataVerification = await verifyWithInclusion({
      dataType: metadata.dataType,
      dataItem: metadata.dataItem,
      kayrosHash: metadata.kayrosHash,
      apiKey,
    });

    if (!metadataVerification.valid) {
      row.status = 'failed';
      row.note = metadataVerification.error ?? 'Metadata proof verification failed.';
      return;
    }

    const storedMerkleProof = bundle.merkleProof as
      | { content?: unknown; metadata?: unknown }
      | undefined;

    if (storedMerkleProof?.content && contentVerification.details?.proof) {
      const result = checkMerkleProofCompatibility(
        storedMerkleProof.content as never,
        contentVerification.details.proof as never,
      );
      if (!result.compatible) {
        row.status = 'failed';
        row.note = `Stored content merkle proof is invalid: ${result.mismatches[0]?.message ?? 'unknown mismatch'}`;
        return;
      }
    }

    if (storedMerkleProof?.metadata && metadataVerification.details?.proof) {
      const result = checkMerkleProofCompatibility(
        storedMerkleProof.metadata as never,
        metadataVerification.details.proof as never,
      );
      if (!result.compatible) {
        row.status = 'failed';
        row.note = `Stored metadata merkle proof is invalid: ${result.mismatches[0]?.message ?? 'unknown mismatch'}`;
        return;
      }
    }

    row.status = 'success';
    row.note = null;
  } catch (err) {
    row.status = 'failed';
    row.note = err instanceof Error ? err.message : String(err);
  } finally {
    row.verifying = false;
  }
}

onMounted(async () => {
  busy.value = true;
  try {
    await loadSettings();
  } finally {
    busy.value = false;
  }
  await startProofsAutoRefresh();
});

onBeforeUnmount(() => {
  stopProofsAutoRefresh();
  if (successMessageTimer !== undefined) {
    window.clearTimeout(successMessageTimer);
    successMessageTimer = undefined;
  }
});
</script>

<template>
  <main class="shell">
    <section class="topbar">
      <div class="brand">
        <img alt="Kayros" class="brand__logo" src="/logo.png" />
        <div class="brand__center">
          <h1>Kayros</h1>
        </div>
      </div>
    </section>

    <nav class="tabbar" aria-label="Kayros sections">
      <button class="tab-btn" :data-active="activeTab === 'proofs'" @click="activeTab = 'proofs'">
        <span class="tab-label">
          <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 4h7l5 5v10a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
            <path
              d="M14 4v5h5M9 13h6M9 16h6"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <span>Proofs</span>
        </span>
      </button>
      <button class="tab-btn" :data-active="activeTab === 'lookup'" @click="activeTab = 'lookup'">
        <span class="tab-label">
          <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle
              cx="11"
              cy="11"
              r="6.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            />
            <path
              d="M16 16l4 4"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.8"
            />
          </svg>
          <span>Lookup</span>
        </span>
      </button>
      <button class="tab-btn" :data-active="activeTab === 'register'" @click="activeTab = 'register'">
        <span class="tab-label">
          <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.8"
            />
          </svg>
          <span>Register</span>
        </span>
      </button>
      <button class="tab-btn" :data-active="activeTab === 'settings'" @click="activeTab = 'settings'">
        <span class="tab-label">
          <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M4 17h16" />
            <circle cx="9" cy="7" r="2" />
            <circle cx="15" cy="17" r="2" />
          </svg>
          <span>Settings</span>
        </span>
      </button>
    </nav>

    <section v-if="activeTab === 'proofs'" class="tab-surface stack">
      <div class="proofs-panel">
        <div v-if="proofRows.length" class="proof-history-controls">
          <label aria-label="Rows per page">
            <select
              :value="proofPageSize"
              @change="proofPageSize = Number(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="size in proofPageSizeOptions" :key="size" :value="size">
                {{ size }}
              </option>
            </select>
          </label>
          <div class="proof-history-pages" aria-label="Proof pagination">
            <button class="icon-action" :disabled="proofPage === 1" aria-label="Previous page" @click="setProofPage(proofPage - 1)">
              ‹
            </button>
            <span>{{ proofPage }} / {{ proofPageCount }}</span>
            <button class="icon-action" :disabled="proofPage === proofPageCount" aria-label="Next page" @click="setProofPage(proofPage + 1)">
              ›
            </button>
          </div>
        </div>

        <p v-if="proofRows.length === 0" class="empty-state">
          no proofs created
        </p>

        <div v-else class="proof-history-list">
          <article
            v-for="row in pagedProofRows"
            :key="proofKey(row)"
            class="proof-history-row"
            :data-expanded="row.expanded"
            :data-status="row.status"
          >
            <button class="proof-history-summary" type="button" @click="toggleProofRow(row)">
              <span class="proof-history-status">
                <svg v-if="row.status === 'success'" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m5 12 5 5L20 7" />
                </svg>
                <svg v-else aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 6l12 12" />
                  <path d="M18 6 6 18" />
                </svg>
              </span>
              <span class="proof-history-time">{{ formatProofTimestamp(row.createdAt) }}</span>
              <span class="proof-history-main">
                <strong>{{ row.dataType }}</strong>
                <small>{{ row.contentHash }}</small>
              </span>
              <span class="proof-history-expand" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>

            <div v-if="row.expanded" class="proof-history-details">
              <p v-if="row.loading" class="empty-state">Loading proof…</p>

              <template v-else-if="row.bundle">
                <dl class="proof-history-fields">
                  <div>
                    <dt>File</dt>
                    <dd>
                      <code>{{ proofCurrentFilePath(row) || '—' }}</code>
                      <button
                        class="icon-action"
                        :disabled="!proofCurrentFilePath(row)"
                        title="Copy file path"
                        aria-label="Copy file path"
                        @click="copyText(proofCurrentFilePath(row))"
                      >
                        ⧉
                      </button>
                    </dd>
                  </div>

                  <div>
                    <dt>Data type</dt>
                    <dd>
                      <code>{{ proofDataType(row) || '—' }}</code>
                      <button
                        class="icon-action"
                        :disabled="!proofDataType(row)"
                        title="Copy data type"
                        aria-label="Copy data type"
                        @click="copyText(proofDataType(row))"
                      >
                        ⧉
                      </button>
                    </dd>
                  </div>

                  <div>
                    <dt>Data hash</dt>
                    <dd>
                      <code>{{ proofDataHash(row) || '—' }}</code>
                      <button
                        class="icon-action"
                        :disabled="!proofDataHash(row)"
                        title="Copy data hash"
                        aria-label="Copy data hash"
                        @click="copyText(proofDataHash(row))"
                      >
                        ⧉
                      </button>
                    </dd>
                  </div>

                  <div>
                    <dt>Record hash</dt>
                    <dd>
                      <code>{{ proofRecordHash(row) || '—' }}</code>
                      <button
                        class="icon-action"
                        :disabled="!proofRecordHash(row)"
                        title="Copy record hash"
                        aria-label="Copy record hash"
                        @click="copyText(proofRecordHash(row))"
                      >
                        ⧉
                      </button>
                    </dd>
                  </div>
                </dl>

                <article v-if="row.bundle.meta" class="proof-file-card">
                  <div class="proof-file-head">
                    <h3>Meta</h3>
                    <button
                      class="icon-action"
                      :disabled="!row.bundle.meta"
                      title="Copy meta"
                      aria-label="Copy meta"
                      @click="copyText(jsonText(row.bundle.meta))"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="9" y="9" width="10" height="10" rx="2" />
                        <rect x="5" y="5" width="10" height="10" rx="2" />
                      </svg>
                    </button>
                  </div>
                  <textarea readonly :value="jsonText(row.bundle.meta)" />
                </article>

                <article v-if="row.bundle.proof" class="proof-file-card">
                  <div class="proof-file-head">
                    <h3>Proof</h3>
                    <button
                      class="icon-action"
                      :disabled="!row.bundle.proof"
                      title="Copy proof"
                      aria-label="Copy proof"
                      @click="copyText(jsonText(row.bundle.proof))"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="9" y="9" width="10" height="10" rx="2" />
                        <rect x="5" y="5" width="10" height="10" rx="2" />
                      </svg>
                    </button>
                  </div>
                  <textarea readonly :value="jsonText(row.bundle.proof)" />
                </article>

                <article v-if="row.bundle.merkleProof !== undefined" class="proof-file-card">
                  <div class="proof-file-head">
                    <h3>Merkle proof</h3>
                    <button
                      class="icon-action"
                      title="Copy merkle proof"
                      aria-label="Copy merkle proof"
                      @click="copyText(jsonText(row.bundle.merkleProof))"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="9" y="9" width="10" height="10" rx="2" />
                        <rect x="5" y="5" width="10" height="10" rx="2" />
                      </svg>
                    </button>
                  </div>
                  <textarea readonly :value="jsonText(row.bundle.merkleProof)" />
                </article>

                <div class="proof-action-stack">
                  <button class="proof-action-btn" :disabled="rowBusy(row)" @click="downloadAllFiles(row)">
                    Download all
                  </button>
                  <button class="proof-action-btn" :disabled="rowBusy(row) || !row.bundle.proof" @click="updateProofRow(row)">
                    Update
                  </button>
                  <button class="proof-action-btn" :disabled="rowBusy(row) || !row.bundle.proof" @click="verifyProofRow(row)">
                    Verify
                  </button>
                </div>

                <p v-if="row.note" class="proof-note">{{ row.note }}</p>
              </template>

              <p v-else class="empty-state">No archived proof bundle.</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'lookup'" class="tab-surface stack">
      <article class="panel panel--action">
        <div class="panel-head">
          <h2>Lookup record</h2>
          <button :disabled="busy || !lookupHash.trim()" @click="lookupCurrentHash">
            Lookup
          </button>
        </div>

        <label>
          <span>Kayros record hash (hash_item)</span>
          <textarea
            v-model.trim="lookupHash"
            rows="5"
            placeholder="Paste a Kayros record hash here"
          />
        </label>

        <div v-if="lookupResult" class="result-box">
          <textarea readonly :value="jsonText(lookupResult)" />
        </div>
      </article>

      <article class="panel panel--action">
        <div class="panel-head">
          <h2>Lookup by data hash</h2>
          <button :disabled="busy || !lookupDataItem.trim()" @click="lookupCurrentDataItem">
            Find
          </button>
        </div>

        <label>
          <span>Content or metadata hash (data_item)</span>
          <textarea
            v-model.trim="lookupDataItem"
            rows="5"
            placeholder="Paste a content or metadata hash here"
          />
        </label>

        <div v-if="lookupDataItemResult" class="result-box">
          <textarea readonly :value="jsonText(lookupDataItemResult)" />
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'register'" class="tab-surface stack">
      <article class="panel panel--action">
        <div class="panel-head">
          <h2>Register hash</h2>
          <button :disabled="busy || !registerHash.trim()" @click="notarizeCurrentHash">
            Notarize
          </button>
        </div>

        <label>
          <span>Content hash</span>
          <textarea
            v-model.trim="registerHash"
            rows="5"
            placeholder="Paste a hex or base64 hash here"
          />
        </label>

        <div v-if="registerResult" class="result-box">
          <textarea readonly :value="jsonText(registerResult)" />
        </div>
      </article>

      <article class="panel panel--action">
        <div class="panel-head">
          <h2>Register raw content</h2>
          <button :disabled="busy || !registerRawContent.trim()" @click="notarizeRawContent">
            Hash and notarize
          </button>
        </div>

        <label>
          <span>Raw content</span>
          <textarea
            v-model="registerRawContent"
            rows="8"
            placeholder="Paste the raw content here"
          />
        </label>

        <div v-if="registerRawResult" class="result-box">
          <textarea readonly :value="jsonText(registerRawResult)" />
        </div>
      </article>
    </section>

    <section v-else class="tab-surface stack">
      <article class="panel">
        <div class="panel-head">
          <h2>Settings</h2>
          <button :disabled="busy" @click="saveSettings">Save</button>
        </div>

        <label>
          <span>Kayros host</span>
          <input v-model.trim="settings.kayrosHost" autocomplete="off" />
        </label>

        <label>
          <span>Data type</span>
          <input v-model.trim="settings.dataType" autocomplete="off" />
        </label>

        <label>
          <span>User key</span>
          <input v-model.trim="settings.userKey" autocomplete="off" />
        </label>

        <label class="toggle-row">
          <span>
            <strong>Save Merkle proofs when fetched</strong>
          </span>
          <input
            v-model="settings.saveMerkleProofs"
            class="switch"
            :disabled="busy"
            type="checkbox"
            @change="saveMerkleProofsSetting"
          />
        </label>
      </article>

      <article class="panel danger-panel">
        <div class="panel-head">
          <h2>Delete Kayros Data</h2>
        </div>
        <label>
          <p>Removes Kayros settings and all archived proofs stored by this app.</p>
          <span class="delete-warning">Permanent action. Data cannot be recovered.</span>
        </label>
        <label>
          <span>Type DELETE</span>
          <input v-model.trim="deleteConfirmText" autocomplete="off" />
        </label>
        <button
          class="btn btn--danger"
          :disabled="busy || deleteConfirmText !== 'DELETE'"
          @click="deleteKayrosData"
        >
          Delete Kayros data
        </button>
      </article>
    </section>
  </main>
  <div v-if="successMessage" class="toast" role="status" aria-live="polite">
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m5 12 5 5L20 7" />
    </svg>
    <span>{{ successMessage }}</span>
  </div>
</template>
