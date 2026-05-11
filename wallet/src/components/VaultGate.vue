<script setup lang="ts">
import ErrorNotice from '@/components/ErrorNotice.vue';
import type { WalletStatus } from '@/lib/types';

defineProps<{
  status: WalletStatus;
  vaultForm: {
    passphrase: string;
    confirmPassphrase: string;
  };
  busy: boolean;
  canSubmitVault: boolean;
  vaultPasswordTooShort: boolean;
  vaultConfirmMismatch: boolean;
  approvalOpen: boolean;
  errorMessage: string;
  errorDetails: string;
}>();

const emit = defineEmits<{
  submit: [];
  rejectExternal: [];
  clearError: [];
}>();
</script>

<template>
  <section class="vault-gate">
    <article class="vault-dialog">
      <img alt="Wallet" class="vault-logo" src="/logo.svg" />
      <div class="vault-copy">
        <h1>{{ status.exists ? 'Unlock Wallet' : 'Create Wallet Password' }}</h1>
        <p>
          {{ status.exists
            ? 'Enter your wallet password.'
            : 'Choose a wallet password to encrypt recovery phrases and private keys.' }}
        </p>
        <p v-if="approvalOpen" class="external-request-note">
          External PrivacySafe app is waiting for wallet approval. Unlock the wallet to review the request.
        </p>
        <button
          v-if="approvalOpen"
          class="btn btn--secondary"
          :disabled="busy"
          @click="emit('rejectExternal')"
        >
          Reject external request
        </button>
      </div>

      <div class="form-stack">
        <label>
          <span>Wallet password</span>
          <input
            v-model="vaultForm.passphrase"
            :autocomplete="status.exists ? 'current-password' : 'new-password'"
            type="password"
            :minlength="status.exists ? undefined : 4"
            @keyup.enter="canSubmitVault && emit('submit')"
          />
        </label>
        <label v-if="!status.exists">
          <span>Confirm password</span>
          <input
            v-model="vaultForm.confirmPassphrase"
            autocomplete="new-password"
            type="password"
            minlength="4"
            @keyup.enter="canSubmitVault && emit('submit')"
          />
        </label>
        <p v-if="vaultPasswordTooShort" class="field-error">Password must be at least 4 characters.</p>
        <p v-if="vaultConfirmMismatch" class="field-error">Passwords do not match.</p>
        <button class="btn btn--primary" :disabled="busy || !canSubmitVault" @click="emit('submit')">
          {{ status.exists ? 'Unlock wallet' : 'Create wallet' }}
        </button>
      </div>

      <ErrorNotice
        v-if="errorMessage"
        :message="errorMessage"
        :details="errorDetails"
        @close="emit('clearError')"
      />
    </article>
  </section>
</template>
