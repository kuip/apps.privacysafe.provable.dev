<script setup lang="ts">
defineProps<{
  busy: boolean;
}>();

defineEmits<{
  lock: [];
}>();
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <img alt="Wallet" class="brand__logo" src="/logo.svg" />
      <div class="brand__center">
        <h1>Wallet</h1>
      </div>
      <button
        class="lock-toggle"
        :disabled="busy"
        title="Lock wallet"
        aria-label="Lock wallet"
        @click="$emit('lock')"
      >
        <svg class="lock-icon" aria-hidden="true" viewBox="0 0 24 24">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 7.5-2" />
        </svg>
      </button>
    </div>
  </header>
</template>
