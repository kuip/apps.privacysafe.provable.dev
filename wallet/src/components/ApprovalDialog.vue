<script setup lang="ts">
defineProps<{
  open: boolean;
  busy: boolean;
  title: string;
  actionLabel: string;
  rows: string[][];
  payloadText: string;
}>();

const emit = defineEmits<{
  approve: [];
  reject: [];
}>();
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('reject')">
    <section class="password-modal approval-modal" role="dialog" aria-modal="true" :aria-labelledby="'approval-dialog-title'">
      <div class="panel__header">
        <div>
          <h2 id="approval-dialog-title">{{ title }}</h2>
          <p class="approval-subtitle">External PrivacySafe app is requesting wallet access.</p>
        </div>
        <button
          class="error-notice__close"
          :disabled="busy"
          title="Reject"
          aria-label="Reject"
          @click="emit('reject')"
        >
          ×
        </button>
      </div>
      <dl class="approval-details">
        <div v-for="row in rows" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }}</dd>
        </div>
      </dl>
      <details class="approval-raw">
        <summary>Request details</summary>
        <pre>{{ payloadText }}</pre>
      </details>
      <div class="modal-actions">
        <button class="btn btn--secondary" :disabled="busy" @click="emit('reject')">
          Reject
        </button>
        <button class="btn btn--primary" :disabled="busy" @click="emit('approve')">
          {{ actionLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
