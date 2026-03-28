<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { callThisAppService } from '@/lib/json-rpc';
import { KAYROS_SERVICE_NAME } from '@/lib/constants';
import type {
  KayrosSettings,
  LookupDataItemResult,
  LookupRecordResult,
  RegisterHashResult,
} from '@/lib/types';

const settings = reactive<KayrosSettings>({
  kayrosHost: '',
  dataType: '',
  userKey: '',
});

const registerHash = ref('');
const lookupHash = ref('');
const lookupDataItem = ref('');
const busy = ref(false);
const message = ref('');
const registerResult = ref<RegisterHashResult | null>(null);
const lookupResult = ref<LookupRecordResult | null>(null);
const lookupDataItemResult = ref<LookupDataItemResult | null>(null);

const prettyRegister = computed(() => (
  registerResult.value ? JSON.stringify(registerResult.value, null, 2) : ''
));
const prettyLookup = computed(() => (
  lookupResult.value ? JSON.stringify(lookupResult.value, null, 2) : ''
));
const prettyLookupDataItem = computed(() => (
  lookupDataItemResult.value ? JSON.stringify(lookupDataItemResult.value, null, 2) : ''
));

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
  message.value = '';
  try {
    const saved = await callThisAppService<Partial<KayrosSettings>, KayrosSettings>(
      KAYROS_SERVICE_NAME,
      'saveSettings',
      settings,
    );
    Object.assign(settings, saved);
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

onMounted(async () => {
  busy.value = true;
  try {
    await loadSettings();
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">PrivacySafe subapp</p>
        <h1>Kayros Notary</h1>
        <p class="lede">
          Register an existing content hash with Kayros and look records back up through the same RPC service that Storage can call later.
        </p>
      </div>
      <img alt="Kayros" class="mark" src="/logo.png" />
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Settings</h2>
        <button :disabled="busy" @click="saveSettings">Save</button>
      </div>
      <p class="panel-text">
        These values are used by the Kayros RPC service when Storage requests upload-time notarization.
      </p>

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
    </section>

    <section class="grid grid--triple">
      <article class="panel panel--action">
        <div class="panel-head">
          <h2>Register hash</h2>
          <button :disabled="busy || !registerHash.trim()" @click="notarizeCurrentHash">
            Notarize
          </button>
        </div>
        <p class="panel-text">
          Submit an existing content hash exactly as Storage or another client produced it.
        </p>

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
          <h2>Lookup record</h2>
          <button :disabled="busy || !lookupHash.trim()" @click="lookupCurrentHash">
            Lookup
          </button>
        </div>
        <p class="panel-text">
          Load a previously registered record from Kayros using the same hash value.
        </p>

        <label>
          <span>Kayros record hash</span>
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
          <h2>Lookup by content hash</h2>
          <button :disabled="busy || !lookupDataItem.trim()" @click="lookupCurrentDataItem">
            Find
          </button>
        </div>
        <p class="panel-text">
          Find records by the original content or metadata hash that was notarized.
        </p>

        <label>
          <span>Content or metadata hash</span>
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

    <footer class="status-bar">
      <p class="status" :data-busy="busy ? 'true' : 'false'">
        {{ busy ? 'Working…' : (message || 'Ready.') }}
      </p>
    </footer>
  </main>
</template>
