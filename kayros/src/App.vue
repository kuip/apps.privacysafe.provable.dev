<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
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
} from '@/lib/types';

type TabId = 'proofs' | 'lookup' | 'register' | 'settings';

const settings = reactive<KayrosSettings>({
  kayrosHost: '',
  dataType: '',
  userKey: '',
  saveMerkleProofs: false,
});

const activeTab = ref<TabId>('settings');
const registerHash = ref('');
const registerRawContent = ref('');
const lookupHash = ref('');
const lookupDataItem = ref('');
const proofsDataType = ref('');
const busy = ref(false);
const message = ref('');

const registerResult = ref<RegisterHashResult | null>(null);
const registerRawResult = ref<RegisterHashResult | null>(null);
const lookupResult = ref<LookupRecordResult | null>(null);
const lookupDataItemResult = ref<LookupDataItemResult | null>(null);
const proofEntries = ref<ArchivedProofListEntry[]>([]);
const selectedProof = ref<ArchivedProofBundle | null>(null);

const prettyRegister = computed(() => (
  registerResult.value ? JSON.stringify(registerResult.value, null, 2) : ''
));
const prettyLookup = computed(() => (
  lookupResult.value ? JSON.stringify(lookupResult.value, null, 2) : ''
));
const prettyRegisterRaw = computed(() => (
  registerRawResult.value ? JSON.stringify(registerRawResult.value, null, 2) : ''
));
const prettyLookupDataItem = computed(() => (
  lookupDataItemResult.value ? JSON.stringify(lookupDataItemResult.value, null, 2) : ''
));
const prettySelectedProof = computed(() => (
  selectedProof.value?.proof ? JSON.stringify(selectedProof.value.proof, null, 2) : ''
));
const prettySelectedMerkleProof = computed(() => (
  selectedProof.value?.merkleProof !== undefined
    ? JSON.stringify(selectedProof.value.merkleProof, null, 2)
    : ''
));
const prettySelectedMeta = computed(() => (
  selectedProof.value?.meta ? JSON.stringify(selectedProof.value.meta, null, 2) : ''
));

function currentProofsDataType() {
  return proofsDataType.value.trim() || settings.dataType;
}

async function loadSettings() {
  const loaded = await callThisAppService<void, KayrosSettings>(
    KAYROS_SERVICE_NAME,
    'getSettings',
    undefined as void,
  );
  Object.assign(settings, loaded);
  if (!proofsDataType.value.trim()) {
    proofsDataType.value = loaded.dataType;
  }
}

async function saveSettings() {
  busy.value = true;
  message.value = '';
  try {
    const saved = await callThisAppService<Partial<KayrosSettings>, KayrosSettings>(
      KAYROS_SERVICE_NAME,
      'saveSettings',
      settings,
    );
    Object.assign(settings, saved);
    if (!proofsDataType.value.trim()) {
      proofsDataType.value = saved.dataType;
    }
    message.value = 'Settings saved.';
  } finally {
    busy.value = false;
  }
}

async function notarizeCurrentHash() {
  busy.value = true;
  message.value = '';
  registerResult.value = null;
  try {
    registerResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'registerHash',
      {
        hash: registerHash.value,
      },
    );
    message.value = 'Hash submitted to Kayros.';
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
  message.value = '';
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
    message.value = 'Raw content hashed and submitted to Kayros.';
  } finally {
    busy.value = false;
  }
}

async function lookupCurrentHash() {
  busy.value = true;
  message.value = '';
  lookupResult.value = null;
  try {
    lookupResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'lookupRecord',
      {
        hash: lookupHash.value,
      },
    );
    message.value = 'Record loaded from Kayros.';
  } finally {
    busy.value = false;
  }
}

async function lookupCurrentDataItem() {
  busy.value = true;
  message.value = '';
  lookupDataItemResult.value = null;
  try {
    lookupDataItemResult.value = await callThisAppService(
      KAYROS_SERVICE_NAME,
      'lookupDataItem',
      {
        dataItem: lookupDataItem.value,
      },
    );
    message.value = 'Records loaded from Kayros.';
  } finally {
    busy.value = false;
  }
}

async function loadProofs() {
  busy.value = true;
  message.value = '';
  selectedProof.value = null;
  try {
    const result = await callThisAppService<{ dataType: string }, ListArchivedProofsResult>(
      KAYROS_SERVICE_NAME,
      'listProofs',
      {
        dataType: currentProofsDataType(),
      },
    );
    proofEntries.value = result.entries;
    message.value = `Loaded ${result.entries.length} archived proof${result.entries.length === 1 ? '' : 's'}.`;
  } finally {
    busy.value = false;
  }
}

async function selectProof(entry: ArchivedProofListEntry) {
  busy.value = true;
  message.value = '';
  try {
    const request = {
      dataType: currentProofsDataType(),
      contentHash: entry.contentHash,
    };

    const [proof, merkleProof, meta] = await Promise.all([
      callThisAppService<typeof request, ArchivedProofBundle['proof']>(
        KAYROS_SERVICE_NAME,
        'getProofFile',
        request,
      ),
      entry.hasMerkleProof
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

    selectedProof.value = {
      dataType: request.dataType,
      contentHash: entry.contentHash,
      proof,
      merkleProof,
      meta,
    };
    message.value = 'Archived proof loaded.';
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  busy.value = true;
  try {
    await loadSettings();
    await loadProofs();
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <h1>Kayros Cryptographic Integrity Proofs</h1>
      </div>
      <img alt="Kayros" class="mark" src="/logo.png" />
    </section>

    <nav class="tabs" aria-label="Kayros sections">
      <button :class="['tab', activeTab === 'proofs' && 'tab--active']" @click="activeTab = 'proofs'">
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
      <button :class="['tab', activeTab === 'lookup' && 'tab--active']" @click="activeTab = 'lookup'">
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
      <button :class="['tab', activeTab === 'register' && 'tab--active']" @click="activeTab = 'register'">
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
      <button :class="['tab', activeTab === 'settings' && 'tab--active']" @click="activeTab = 'settings'">
        <span class="tab-label">
          <svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 8.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            />
            <path
              d="M4.5 13.5v-3l2.1-.6c.2-.5.4-1 .8-1.4L6.9 6.4l2.1-2.1l2.1.5c.4-.2.9-.4 1.4-.6l1.1-1.7h3l1.1 1.7c.5.2 1 .4 1.4.6l2.1-.5l2.1 2.1l-.5 2.1c.3.4.6.9.8 1.4l2.1.6v3l-2.1.6c-.2.5-.4 1-.8 1.4l.5 2.1l-2.1 2.1l-2.1-.5c-.4.3-.9.5-1.4.8l-1.1 1.7h-3l-1.1-1.7c-.5-.2-1-.4-1.4-.8l-2.1.5l-2.1-2.1l.5-2.1c-.3-.4-.6-.9-.8-1.4Z"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.2"
            />
          </svg>
          <span>Settings</span>
        </span>
      </button>
    </nav>

    <section v-if="activeTab === 'settings'" class="panel">
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

      <label class="checkbox">
        <input v-model="settings.saveMerkleProofs" type="checkbox" />
        <span>Save Merkle proofs when fetched</span>
      </label>
    </section>

    <section v-else-if="activeTab === 'lookup'" class="stack">
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

        <div v-if="prettyLookup" class="result-box">
          <pre>{{ prettyLookup }}</pre>
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

        <div v-if="prettyLookupDataItem" class="result-box">
          <pre>{{ prettyLookupDataItem }}</pre>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'register'" class="stack">
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

        <div v-if="prettyRegister" class="result-box">
          <pre>{{ prettyRegister }}</pre>
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

        <div v-if="prettyRegisterRaw" class="result-box">
          <pre>{{ prettyRegisterRaw }}</pre>
        </div>
      </article>
    </section>

    <section v-else class="proofs-layout">
      <article class="panel proofs-filter">
        <div class="panel-head">
          <h2>Proofs</h2>
          <button :disabled="busy" @click="loadProofs">Refresh</button>
        </div>

        <label>
          <span>Data type</span>
          <input v-model.trim="proofsDataType" autocomplete="off" />
        </label>

        <div class="proof-list">
          <button
            v-for="entry in proofEntries"
            :key="entry.contentHash"
            :class="['proof-item', selectedProof?.contentHash === entry.contentHash && 'proof-item--active']"
            @click="selectProof(entry)"
          >
            <strong>{{ entry.meta?.originalFilename || entry.contentHash }}</strong>
            <span>{{ entry.contentHash }}</span>
            <small>{{ entry.meta?.currentFilePath || 'No stored path' }}</small>
          </button>
          <p v-if="proofEntries.length === 0" class="empty-state">
            No archived proofs for this data type yet.
          </p>
        </div>
      </article>

      <section class="stack">
        <article class="panel panel--proof-detail">
          <div class="panel-head">
            <h2>Meta</h2>
          </div>
          <div v-if="prettySelectedMeta" class="result-box result-box--detail">
            <pre>{{ prettySelectedMeta }}</pre>
          </div>
          <p v-else class="empty-state">Select a proof to inspect its archive metadata.</p>
        </article>

        <article class="panel panel--proof-detail">
          <div class="panel-head">
            <h2>Proof</h2>
          </div>
          <div v-if="prettySelectedProof" class="result-box result-box--detail">
            <pre>{{ prettySelectedProof }}</pre>
          </div>
          <p v-else class="empty-state">Select a proof to inspect the stored proof JSON.</p>
        </article>

        <article class="panel panel--proof-detail">
          <div class="panel-head">
            <h2>Merkle proof</h2>
          </div>
          <div v-if="prettySelectedMerkleProof" class="result-box result-box--detail">
            <pre>{{ prettySelectedMerkleProof }}</pre>
          </div>
          <p v-else class="empty-state">No archived Merkle proof stored for this item.</p>
        </article>
      </section>
    </section>

    <footer class="status-bar">
      <p class="status" :data-busy="busy ? 'true' : 'false'">
        {{ busy ? 'Working…' : (message || 'Ready.') }}
      </p>
    </footer>
  </main>
</template>
