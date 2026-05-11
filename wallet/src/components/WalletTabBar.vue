<script setup lang="ts">
type WalletTab = 'home' | 'create' | 'settings' | 'history';

defineProps<{
  activeTab: WalletTab;
}>();

const emit = defineEmits<{
  'update:activeTab': [tab: WalletTab];
}>();
</script>

<template>
  <nav class="tabbar" aria-label="Wallet sections">
    <button class="tab-btn" :data-active="activeTab === 'home'" aria-label="Account" @click="emit('update:activeTab', 'home')">
      <svg class="tab-icon" aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
      <span class="tab-label">Account</span>
    </button>
    <button class="tab-btn" :data-active="activeTab === 'create'" aria-label="Add account" @click="emit('update:activeTab', 'create')">
      <svg class="tab-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
      <span class="tab-label">Add</span>
    </button>
    <button class="tab-btn" :data-active="activeTab === 'history'" aria-label="History" @click="emit('update:activeTab', 'history')">
      <svg class="tab-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7v5h5" />
        <path d="M5 12a7 7 0 1 0 2-5" />
        <path d="M12 8v5l3 2" />
      </svg>
      <span class="tab-label">History</span>
    </button>
    <button class="tab-btn" :data-active="activeTab === 'settings'" aria-label="Settings" @click="emit('update:activeTab', 'settings')">
      <svg class="tab-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h16" />
        <path d="M4 17h16" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="17" r="2" />
      </svg>
      <span class="tab-label">Settings</span>
    </button>
  </nav>
</template>
