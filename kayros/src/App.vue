<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { getRecordUrl, setKayrosHost } from '@kuip/provable-sdk';
import { callThisAppService } from '@/lib/json-rpc';
import { KAYROS_SERVICE_NAME } from '@/lib/constants';
import type {
  ArchivedProofActionResult,
  ArchivedProofBundle,
  ArchivedProofListEntry,
  ArchivedProofStatus,
  KayrosSettings,
  ListArchivedProofsResult,
  LookupDataItemResult,
  LookupRecordResult,
  RegisterHashResult,
} from '@/lib/types';

type TabId = 'proofs' | 'lookup' | 'register' | 'settings';
type ProofVisualStatus =
  | 'working'
  | 'valid-with-merkle'
  | 'valid-no-merkle'
  | 'valid-pending-merkle'
  | 'valid-invalid-merkle'
  | 'invalid-proof';

interface ProofRowView extends ArchivedProofListEntry {
  expanded: boolean;
  loading: boolean;
  updating: boolean;
  verifying: boolean;
  status: ArchivedProofStatus;
  bundle: ArchivedProofBundle | null;
  note: string | null;
  details: string[];
}

const settings = reactive<KayrosSettings>({
  kayrosHost: '',
  dataType: '',
  userKey: '',
  saveMerkleProofs: false,
});

const activeTab = ref<TabId>('proofs');
const registerHash = ref('');
const registerHashTitle = ref('');
const registerRawContent = ref('');
const registerRawTitle = ref('');
const lookupHash = ref('');
const lookupDataItem = ref('');
const busy = ref(false);
const deleteConfirmText = ref('');
const removeProofTarget = ref<ProofRowView | null>(null);
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

function normalizeRegisterHashInput(value: string): string {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? trimmed.slice(2)
    : trimmed;
  return /^[0-9a-fA-F]{64}$/.test(withoutPrefix) ? withoutPrefix : trimmed;
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

function proofTitle(row: ProofRowView): string {
  return typeof row.title === 'string' ? row.title.trim() : '';
}

function proofDataHash(row: ProofRowView): string {
  const hash = row.bundle?.proof?.kayros?.hash;
  return typeof hash === 'string' ? hash : row.contentHash;
}

function proofRecordHash(row: ProofRowView): string {
  const hash = row.bundle?.proof?.kayros?.timestamp?.response?.response?.hash;
  return typeof hash === 'string' ? hash : '';
}

function proofRecordUrl(row: ProofRowView): string {
  const hash = row.bundle?.proof?.kayros?.timestamp?.response?.response?.hash;
  const dataType = row.bundle?.proof?.kayros?.timestamp?.response?.data?.data_type;
  if (
    typeof hash !== 'string' || !hash.trim()
    || typeof dataType !== 'string' || !dataType.trim()
  ) {
    return '';
  }

  setKayrosHost(settings.kayrosHost);
  return getRecordUrl(hash, dataType);
}

async function openExternalUrl(url: string): Promise<void> {
  if (!url) {
    return;
  }
  if (w3n.shell?.openURL) {
    await w3n.shell.openURL(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function rowBusy(row: ProofRowView): boolean {
  return busy.value || row.loading || row.updating || row.verifying;
}

function proofVisualStatus(row: ProofRowView): ProofVisualStatus {
  if (row.updating || row.verifying) {
    return 'working';
  }

  if (row.status === 'proof_invalid') {
    return 'invalid-proof';
  }

  if (!row.hasMerkleProof) {
    return 'valid-no-merkle';
  }

  if (row.status === 'merkle_invalid') {
    return 'valid-invalid-merkle';
  }

  if (row.status === 'pending') {
    return 'valid-pending-merkle';
  }

  return 'valid-with-merkle';
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
    registerHashTitle.value = '';
    registerRawContent.value = '';
    registerRawTitle.value = '';
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
    const normalizedHash = normalizeRegisterHashInput(registerHash.value);
    registerHash.value = normalizedHash;
    registerResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'registerHash',
      {
        hash: normalizedHash,
        archiveTitle: registerHashTitle.value,
        archiveLabel: 'Manual hash',
      },
    );
    await loadProofs();
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
        archiveTitle: registerRawTitle.value,
        archiveLabel: 'Raw content',
        archiveRawContent: registerRawContent.value,
      },
    );
    await loadProofs();
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
        status: entry.status,
        bundle: structureChanged ? null : (existing?.bundle ?? null),
        note: existing?.note ?? null,
        details: existing?.details ?? [],
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
    const proof = await callThisAppService<typeof request, ArchivedProofBundle['proof']>(
      KAYROS_SERVICE_NAME,
      'getProofFile',
      request,
    );

    const [metadataProofResult, merkleProofResult, metaResult] = await Promise.allSettled([
      row.hasMeta
        ? callThisAppService<typeof request, ArchivedProofBundle['metadataProof']>(
          KAYROS_SERVICE_NAME,
          'getMetadataProofFile',
          request,
        )
        : Promise.resolve(undefined),
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
      metadataProof: metadataProofResult.status === 'fulfilled' ? metadataProofResult.value : undefined,
      merkleProof: merkleProofResult.status === 'fulfilled' ? merkleProofResult.value : undefined,
      meta: metaResult.status === 'fulfilled' ? metaResult.value : undefined,
    };
  } catch (err) {
    row.bundle = null;
    row.note = err instanceof Error ? err.message : String(err);
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

async function updateProofRow(row: ProofRowView) {
  if (!row.bundle) {
    await loadProofBundle(row);
  }

  if (!row.bundle?.proof) {
    row.status = 'proof_invalid';
    row.note = 'Missing archived proof file.';
    return;
  }

  row.updating = true;
  row.note = null;
  try {
    const result = await callThisAppService<
      { dataType: string; contentHash: string },
      ArchivedProofActionResult
    >(
      KAYROS_SERVICE_NAME,
      'updateArchivedProof',
      {
        dataType: row.dataType,
        contentHash: row.contentHash,
      },
    );

    row.status = result.status;
    row.note = result.note;
    row.details = result.details ?? [];
    if (result.replacedMerkleProof) {
      row.hasMerkleProof = true;
      row.bundle = null;
      await loadProofBundle(row);
    }
    setSuccess(result.note ?? (result.status === 'pending' ? 'Merkle proof is pending.' : 'Proof updated.'));
  } catch (err) {
    row.note = err instanceof Error ? err.message : String(err);
  } finally {
    row.updating = false;
  }
}

async function verifyProofRow(row: ProofRowView) {
  if (!row.bundle) {
    await loadProofBundle(row);
  }

  if (!row.bundle?.proof) {
    row.status = 'proof_invalid';
    row.note = 'Missing archived proof file.';
    return;
  }

  row.verifying = true;
  row.note = null;
  try {
    const result = await callThisAppService<
      { dataType: string; contentHash: string },
      ArchivedProofActionResult
    >(
      KAYROS_SERVICE_NAME,
      'verifyArchivedProof',
      {
        dataType: row.dataType,
        contentHash: row.contentHash,
      },
    );
    row.status = result.status;
    row.note = result.note;
    row.details = result.details ?? [];
    setSuccess(result.note ?? (
      result.status === 'valid'
        ? 'Proof verified.'
        : result.status === 'pending'
          ? 'Merkle proof is pending.'
          : 'Proof verification finished.'
    ));
  } catch (err) {
    row.note = err instanceof Error ? err.message : String(err);
    row.details = [];
  } finally {
    row.verifying = false;
  }
}

function openRemoveProofDialog(row: ProofRowView) {
  removeProofTarget.value = row;
}

function closeRemoveProofDialog() {
  removeProofTarget.value = null;
}

async function removeProofRow() {
  const row = removeProofTarget.value;
  if (!row) {
    return;
  }

  busy.value = true;
  try {
    await callThisAppService<
      { dataType: string; contentHash: string },
      { dataType: string; contentHash: string; removed: true }
    >(
      KAYROS_SERVICE_NAME,
      'removeArchivedProof',
      {
        dataType: row.dataType,
        contentHash: row.contentHash,
      },
    );
    proofRows.value = proofRows.value.filter(entry => proofKey(entry) !== proofKey(row));
    proofPage.value = Math.min(proofPage.value, Math.max(1, Math.ceil(proofRows.value.length / proofPageSize.value)));
    setSuccess('Proof files removed.');
    closeRemoveProofDialog();
  } finally {
    busy.value = false;
  }
}

async function removeMerkleProofRow(row: ProofRowView) {
  if (!row.bundle?.merkleProof) {
    return;
  }

  row.updating = true;
  row.note = null;
  try {
    await callThisAppService<
      { dataType: string; contentHash: string },
      { dataType: string; contentHash: string; removed: true }
    >(
      KAYROS_SERVICE_NAME,
      'removeMerkleProofFile',
      {
        dataType: row.dataType,
        contentHash: row.contentHash,
      },
    );
    row.hasMerkleProof = false;
    row.status = row.status === 'proof_invalid' ? 'proof_invalid' : 'valid';
    if (row.bundle) {
      row.bundle = {
        ...row.bundle,
        merkleProof: undefined,
      };
    }
    row.note = 'Merkle proof removed.';
    row.details = [];
    setSuccess('Merkle proof removed.');
  } finally {
    row.updating = false;
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
            :data-status="proofVisualStatus(row)"
          >
            <button class="proof-history-summary" type="button" @click="toggleProofRow(row)">
              <span class="proof-history-status">
                <svg v-if="row.updating || row.verifying" class="spin" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 4a8 8 0 1 1-5.66 2.34" />
                </svg>
                <svg
                  v-else-if="proofVisualStatus(row) !== 'invalid-proof'"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                >
                  <path d="m5 12 5 5L20 7" />
                </svg>
                <svg v-else aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 6l12 12" />
                  <path d="M18 6 6 18" />
                </svg>
              </span>
              <span class="proof-history-time">{{ formatProofTimestamp(row.createdAt) }}</span>
              <span class="proof-history-main">
                <strong>{{ proofTitle(row) }}</strong>
                <small>{{ row.dataType }}</small>
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

                <article v-if="row.bundle.proof" class="proof-file-card">
                  <div class="proof-file-head">
                    <h3>Proof</h3>
                    <div class="proof-file-actions">
                      <button
                        class="icon-action"
                        :disabled="!proofRecordUrl(row)"
                        title="Open Kayros record"
                        aria-label="Open Kayros record"
                        @click="openExternalUrl(proofRecordUrl(row))"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M14 4h6v6" />
                          <path d="M10 14 20 4" />
                          <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
                        </svg>
                      </button>
                      <button
                        class="icon-action"
                        :disabled="!row.bundle.proof"
                        title="Download proof"
                        aria-label="Download proof"
                        @click="triggerDownload(`${row.contentHash}_proof.json`, jsonText(row.bundle.proof))"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 4v10" />
                          <path d="m8 10 4 4 4-4" />
                          <path d="M5 18h14" />
                        </svg>
                      </button>
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
                  </div>
                  <textarea readonly :value="jsonText(row.bundle.proof)" />
                </article>

                <article v-if="row.bundle.metadataProof" class="proof-file-card">
                  <div class="proof-file-head">
                    <h3>Metadata proof</h3>
                    <div class="proof-file-actions">
                      <button
                        class="icon-action"
                        :disabled="!row.bundle.metadataProof"
                        title="Download metadata proof"
                        aria-label="Download metadata proof"
                        @click="triggerDownload(`${row.contentHash}_metadata_proof.json`, jsonText(row.bundle.metadataProof))"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 4v10" />
                          <path d="m8 10 4 4 4-4" />
                          <path d="M5 18h14" />
                        </svg>
                      </button>
                      <button
                        class="icon-action"
                        :disabled="!row.bundle.metadataProof"
                        title="Copy metadata proof"
                        aria-label="Copy metadata proof"
                        @click="copyText(jsonText(row.bundle.metadataProof))"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="9" y="9" width="10" height="10" rx="2" />
                          <rect x="5" y="5" width="10" height="10" rx="2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <textarea readonly :value="jsonText(row.bundle.metadataProof)" />
                </article>

                <article v-if="row.bundle.merkleProof !== undefined" class="proof-file-card">
                  <div class="proof-file-head">
                    <h3>Merkle proof</h3>
                    <div class="proof-file-actions">
                      <button
                        class="icon-action"
                        title="Remove merkle proof"
                        aria-label="Remove merkle proof"
                        :disabled="rowBusy(row)"
                        @click="removeMerkleProofRow(row)"
                      >
                        <span class="icon-action__glyph" aria-hidden="true">✕</span>
                      </button>
                      <button
                        class="icon-action"
                        title="Download merkle proof"
                        aria-label="Download merkle proof"
                        @click="triggerDownload(`${row.contentHash}_merkle-proof.json`, jsonText(row.bundle.merkleProof))"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 4v10" />
                          <path d="m8 10 4 4 4-4" />
                          <path d="M5 18h14" />
                        </svg>
                      </button>
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
                  </div>
                  <textarea readonly :value="jsonText(row.bundle.merkleProof)" />
                </article>

                <div class="proof-action-stack">
                  <button class="proof-action-btn" :disabled="rowBusy(row) || !row.bundle.proof" @click="updateProofRow(row)">
                    {{ row.updating ? 'Syncing Merkle proof…' : 'Sync Merkle proof' }}
                  </button>
                  <button class="proof-action-btn" :disabled="rowBusy(row) || !row.bundle.proof" @click="verifyProofRow(row)">
                    {{ row.verifying ? 'Verifying…' : 'Verify' }}
                  </button>
                  <button class="proof-action-btn btn--danger" :disabled="rowBusy(row)" @click="openRemoveProofDialog(row)">
                    Remove
                  </button>
                </div>

                <p v-if="row.note" class="proof-note">{{ row.note }}</p>
                <ul v-if="row.details.length" class="proof-details-list">
                  <li v-for="(detail, index) in row.details" :key="`${row.contentHash}-detail-${index}`">
                    {{ detail }}
                  </li>
                </ul>
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
          <button :disabled="busy || !registerHash.trim() || !registerHashTitle.trim()" @click="notarizeCurrentHash">
            Notarize
          </button>
        </div>

        <label>
          <span>Title</span>
          <input
            v-model.trim="registerHashTitle"
            autocomplete="off"
            placeholder="Enter a proof title"
          />
          <small>title will not be included in the data integrity proof</small>
        </label>

        <label>
          <span>Content hash</span>
          <textarea
            v-model.trim="registerHash"
            rows="5"
            placeholder="Paste a 32-byte hex or base64 hash here"
          />
        </label>

        <div v-if="registerResult" class="result-box">
          <textarea readonly :value="jsonText(registerResult)" />
        </div>
      </article>

      <article class="panel panel--action">
        <div class="panel-head">
          <h2>Register raw content</h2>
          <button :disabled="busy || !registerRawContent.trim() || !registerRawTitle.trim()" @click="notarizeRawContent">
            Hash and notarize
          </button>
        </div>

        <label>
          <span>Title</span>
          <input
            v-model.trim="registerRawTitle"
            autocomplete="off"
            placeholder="Enter a proof title"
          />
          <small>title will not be included in the data integrity proof</small>
        </label>

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

  <div v-if="removeProofTarget" class="modal-backdrop" @click.self="closeRemoveProofDialog">
    <section class="confirm-modal">
      <h2>Remove proof files</h2>
      <p>
        This action will permanently remove all files for this proof. You will not be able to recover them.
      </p>
      <div class="modal-actions">
        <button type="button" :disabled="busy" @click="closeRemoveProofDialog">
          Cancel
        </button>
        <button type="button" class="btn--danger" :disabled="busy" @click="removeProofRow">
          Remove
        </button>
      </div>
    </section>
  </div>
</template>
