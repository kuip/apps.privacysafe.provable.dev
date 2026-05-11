<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  busy: boolean;
  title: string;
  actionLabel: string;
  passphrase: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  'update:passphrase': [passphrase: string];
}>();

const passwordInput = ref<HTMLInputElement | null>(null);
const password = computed({
  get: () => props.passphrase,
  set: value => emit('update:passphrase', value),
});

watch(() => props.open, async open => {
  if (!open) {
    return;
  }
  await nextTick();
  passwordInput.value?.focus();
}, { immediate: true });
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section class="password-modal" role="dialog" aria-modal="true" :aria-labelledby="'password-dialog-title'">
      <div class="panel__header">
        <h2 id="password-dialog-title">{{ title }}</h2>
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
      <label>
        <span>Wallet password</span>
        <input
          ref="passwordInput"
          v-model="password"
          autocomplete="current-password"
          type="password"
          @keyup.enter="emit('submit')"
          @keyup.esc="emit('close')"
        />
      </label>
      <div class="modal-actions">
        <button class="btn btn--secondary" :disabled="busy" @click="emit('close')">
          Cancel
        </button>
        <button class="btn btn--primary" :disabled="busy || !passphrase" @click="emit('submit')">
          {{ actionLabel }}
        </button>
      </div>
    </section>
  </div>
</template>
