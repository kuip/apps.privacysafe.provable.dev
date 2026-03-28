<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { callThisAppService } from '@/lib/json-rpc';
import { KAYROS_SERVICE_NAME } from '@/lib/constants';
import type {
  KayrosSettings,
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
const busy = ref(false);
const message = ref('');
const registerResult = ref<RegisterHashResult | null>(null);
const lookupResult = ref<LookupRecordResult | null>(null);

const prettyRegister = computed(() => (
  registerResult.value ? JSON.stringify(registerResult.value, null, 2) : ''
));
const prettyLookup = computed(() => (
  lookupResult.value ? JSON.stringify(lookupResult.value, null, 2) : ''
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
      <div>
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

    <section class="grid">
      <article class="panel">
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

        <pre v-if="prettyRegister">{{ prettyRegister }}</pre>
      </article>

      <article class="panel">
        <div class="panel-head">
          <h2>Lookup record</h2>
          <button :disabled="busy || !lookupHash.trim()" @click="lookupCurrentHash">
            Lookup
          </button>
        </div>

        <label>
          <span>Kayros record hash</span>
          <textarea
            v-model.trim="lookupHash"
            rows="5"
            placeholder="Paste a Kayros record hash here"
          />
        </label>

        <pre v-if="prettyLookup">{{ prettyLookup }}</pre>
      </article>
    </section>

    <p class="status" :data-busy="busy ? 'true' : 'false'">
      {{ busy ? 'Working…' : (message || 'Ready.') }}
    </p>
  </main>
</template>
