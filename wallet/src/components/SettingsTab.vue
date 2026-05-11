<script setup lang="ts">
import type { WalletSettings } from '@/lib/types';

defineProps<{
  busy: boolean;
  settingsForm: WalletSettings;
  passwordForm: {
    currentPassphrase: string;
    newPassphrase: string;
    confirmPassphrase: string;
  };
  resetForm: {
    passphrase: string;
    confirmText: string;
  };
  newPasswordTooShort: boolean;
  passwordConfirmMismatch: boolean;
}>();

const emit = defineEmits<{
  updateSetting: [key: keyof WalletSettings];
  changePassphrase: [];
  resetVault: [];
}>();
</script>

<template>
  <section class="tab-surface settings-grid">
    <article class="panel">
      <div class="panel__header">
        <h2>Signing Rules</h2>
      </div>
      <label class="toggle-row">
        <span>
          <strong>Require password for transfers</strong>
          <small>Applies to ETH, SOL, ERC-20, and SPL token transfers.</small>
        </span>
        <input
          v-model="settingsForm.requirePasswordForTransfers"
          :disabled="busy"
          type="checkbox"
          @change="emit('updateSetting', 'requirePasswordForTransfers')"
        />
      </label>
      <label class="toggle-row">
        <span>
          <strong>Require password for message signing</strong>
          <small>Applies to direct signMessage requests.</small>
        </span>
        <input
          v-model="settingsForm.requirePasswordForMessageSigning"
          :disabled="busy"
          type="checkbox"
          @change="emit('updateSetting', 'requirePasswordForMessageSigning')"
        />
      </label>
      <label class="toggle-row">
        <span>
          <strong>Require password for transaction signing</strong>
          <small>Applies to raw transaction signing from other PrivacySafe apps.</small>
        </span>
        <input
          v-model="settingsForm.requirePasswordForTransactionSigning"
          :disabled="busy"
          type="checkbox"
          @change="emit('updateSetting', 'requirePasswordForTransactionSigning')"
        />
      </label>
      <label class="toggle-row">
        <span>
          <strong>Development networks</strong>
          <small>Shows Ethereum and Solana Testnets in the network selector.</small>
        </span>
        <input
          v-model="settingsForm.enableDevelopmentNetworks"
          :disabled="busy"
          type="checkbox"
          @change="emit('updateSetting', 'enableDevelopmentNetworks')"
        />
      </label>
    </article>

    <article class="panel">
      <div class="panel__header">
        <h2>Change Password</h2>
      </div>
      <label>
        <span>Current password</span>
        <input v-model="passwordForm.currentPassphrase" autocomplete="current-password" type="password" />
      </label>
      <label>
        <span>New password</span>
        <input v-model="passwordForm.newPassphrase" autocomplete="new-password" type="password" minlength="4" />
      </label>
      <label>
        <span>Confirm new password</span>
        <input v-model="passwordForm.confirmPassphrase" autocomplete="new-password" type="password" minlength="4" />
      </label>
      <p v-if="newPasswordTooShort" class="field-error">New password must be at least 4 characters.</p>
      <p v-if="passwordConfirmMismatch" class="field-error">Passwords do not match.</p>
      <button
        class="btn btn--primary"
        :disabled="busy || !passwordForm.currentPassphrase || !passwordForm.newPassphrase || newPasswordTooShort || passwordConfirmMismatch"
        @click="emit('changePassphrase')"
      >
        Change password
      </button>
    </article>

    <article class="panel danger-panel">
      <div class="panel__header">
        <h2>Reset Wallet</h2>
      </div>
      <label>
        <p>Removes all accounts and data.</p>
        <span class="delete-warning">Permanent action. Data cannot be recovered.</span>
      </label>
      <label>
        <span>Wallet password</span>
        <input v-model="resetForm.passphrase" autocomplete="current-password" type="password" />
      </label>
      <label>
        <span>Type DELETE</span>
        <input v-model.trim="resetForm.confirmText" autocomplete="off" />
      </label>
      <button
        class="btn btn--danger"
        :disabled="busy || !resetForm.passphrase || resetForm.confirmText !== 'DELETE'"
        @click="emit('resetVault')"
      >
        Delete vault
      </button>
    </article>
  </section>
</template>
