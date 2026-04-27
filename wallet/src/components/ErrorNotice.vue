<script setup lang="ts">
defineProps<{
  message: string;
  details?: string;
}>();

defineEmits<{
  close: [];
}>();
</script>

<template>
  <section class="error-notice" role="alert">
    <div class="error-notice__header">
      <p>{{ message }}</p>
      <button class="error-notice__close" type="button" aria-label="Dismiss error" @click="$emit('close')">
        x
      </button>
    </div>
    <details v-if="details">
      <summary>Details</summary>
      <pre>{{ details }}</pre>
    </details>
  </section>
</template>
