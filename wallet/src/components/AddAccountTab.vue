<script setup lang="ts">
import { computed } from 'vue';
import type { Chain, WalletPublicState } from '@/lib/types';

const props = defineProps<{
  state: WalletPublicState;
  busy: boolean;
  addForm: { accountName: string };
  mnemonicForm: { mnemonic: string };
  privateKeyForm: { chain: Chain; privateKey: string };
  generatedMnemonic: string;
  selectedSeedGroupId: string;
}>();

const emit = defineEmits<{
  'update:selectedSeedGroupId': [seedGroupId: string];
  create: [];
  importMnemonic: [];
  importPrivateKey: [];
  copy: [text: string];
}>();

const selectedSeedGroup = computed({
  get: () => props.selectedSeedGroupId,
  set: value => emit('update:selectedSeedGroupId', value),
});

const accountNameMissing = computed(() => props.addForm.accountName.length === 0);
</script>

<template>
  <section class="tab-surface add-surface">
    <div class="add-name-row">
      <label class="add-name-field">
        <span>Account name</span>
        <input v-model.trim="addForm.accountName" autocomplete="off" />
      </label>
      <p v-if="accountNameMissing" class="field-error">Account name is required.</p>
    </div>
    <div class="add-sections">
      <article class="panel add-section">
        <div class="panel__header">
          <h2>Generate New Account</h2>
        </div>
        <select v-if="state.seedGroups.length" v-model="selectedSeedGroup" aria-label="Base wallet">
          <option value="">New wallet</option>
          <option v-for="group in state.seedGroups" :key="group.id" :value="group.id">
            New derived account from {{ group.name }} (index {{ group.nextAccountIndex }})
          </option>
        </select>
        <button class="btn btn--primary" :disabled="busy || accountNameMissing" @click="emit('create')">
          Create account
        </button>
        <div v-if="generatedMnemonic" class="recovery-box">
          <span>Recovery phrase for the new wallet</span>
          <code>{{ generatedMnemonic }}</code>
          <button class="btn btn--secondary" :disabled="busy" @click="emit('copy', generatedMnemonic)">
            Copy phrase
          </button>
        </div>
      </article>

      <article class="panel add-section">
        <div class="panel__header">
          <h2>Import Recovery Phrase</h2>
        </div>
        <textarea
          v-model.trim="mnemonicForm.mnemonic"
          rows="3"
          placeholder="BIP-39 mnemonic"
          spellcheck="false"
        />
        <button
          class="btn btn--primary"
          :disabled="busy || !mnemonicForm.mnemonic || accountNameMissing"
          @click="emit('importMnemonic')"
        >
          Import
        </button>
      </article>

      <article class="panel add-section">
        <div class="panel__header">
          <h2>Import Private Key</h2>
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
        <button
          class="btn btn--primary"
          :disabled="busy || !privateKeyForm.privateKey || accountNameMissing"
          @click="emit('importPrivateKey')"
        >
          Import private key
        </button>
      </article>
    </div>
  </section>
</template>
