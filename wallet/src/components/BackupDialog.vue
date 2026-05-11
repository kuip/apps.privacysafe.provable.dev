<script setup lang="ts">
defineProps<{
  open: boolean;
  busy: boolean;
  title: string;
  label: string;
  value: string;
  path: string;
  copyLabel: string;
}>();

const emit = defineEmits<{
  close: [];
  copy: [text: string];
}>();
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section class="password-modal backup-modal" role="dialog" aria-modal="true" :aria-labelledby="'backup-dialog-title'">
      <div class="panel__header">
        <h2 id="backup-dialog-title">{{ title }}</h2>
        <button
          class="error-notice__close"
          :disabled="busy"
          title="Close"
          aria-label="Close"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
      <div class="recovery-box">
        <span>{{ label }}</span>
        <code>{{ value }}</code>
        <small v-if="path">{{ path }}</small>
      </div>
      <div class="modal-actions">
        <button class="btn btn--secondary" :disabled="busy" @click="emit('copy', value)">
          {{ copyLabel }}
        </button>
        <button class="btn btn--primary" :disabled="busy" @click="emit('close')">
          Close
        </button>
      </div>
    </section>
  </div>
</template>
