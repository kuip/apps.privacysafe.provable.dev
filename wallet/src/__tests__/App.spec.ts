import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import { WALLET_INTERNAL_SERVICE_NAME } from '@/lib/constants';
import { readWalletStores } from '@/lib/vault-storage';
import { callThisAppService } from '@/lib/json-rpc';
import { makePublicState, TEST_ETH_PRIVATE_KEY, TEST_MNEMONIC, TEST_PASSWORD } from '@/test/fixtures';
import type { WalletPublicState, WalletStatus } from '@/lib/types';

vi.mock('@/lib/vault-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/vault-storage')>();
  return {
    ...actual,
    readWalletStores: vi.fn(),
  };
});

vi.mock('@/lib/json-rpc', () => ({
  callThisAppService: vi.fn(),
}));

const mockedReadWalletStores = vi.mocked(readWalletStores);
const mockedCallThisAppService = vi.mocked(callThisAppService);

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find(item => item.text().includes(text));
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function setupWalletRpc(options: {
  exists: boolean;
  unlocked?: boolean;
  state?: WalletPublicState;
}): void {
  let exists = options.exists;
  let unlocked = options.unlocked ?? false;
  let state = options.state ?? makePublicState();

  const status = (): WalletStatus => ({
    exists,
    unlocked,
    accountCount: state.accounts.length,
    updatedAt: state.updatedAt,
  });

  mockedReadWalletStores.mockImplementation(async () => ({
    vaultFile: exists ? { updatedAt: state.updatedAt } as Awaited<ReturnType<typeof readWalletStores>>['vaultFile'] : undefined,
    publicState: exists ? state : undefined,
  }));

  mockedCallThisAppService.mockImplementation(async (_service, method, payload) => {
    switch (method) {
      case 'status':
        return status();
      case 'getPublicState':
        return state;
      case 'unlock':
        exists = true;
        unlocked = true;
        return state;
      case 'lock':
        unlocked = false;
        return status();
      case 'updateSettings':
        state = {
          ...state,
          settings: {
            ...state.settings,
            ...(payload as Partial<WalletPublicState['settings']>),
          },
        };
        return state;
      case 'createAccount':
        return { state, seedGroupId: 'seed:test', accountIndex: 0, mnemonic: TEST_MNEMONIC };
      case 'importMnemonic':
      case 'importPrivateKey':
        return state;
      case 'resetVault':
        exists = false;
        unlocked = false;
        state = makePublicState();
        return status();
      default:
        return undefined;
    }
  });
}

async function mountApp() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

describe('locked screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Create Wallet Password with confirmation when there is no vault', async () => {
    setupWalletRpc({ exists: false });

    const wrapper = await mountApp();

    expect(wrapper.text()).toContain('Create Wallet Password');
    expect(wrapper.text()).toContain('Confirm password');
    wrapper.unmount();
  });

  it('shows Unlock Wallet without confirmation when a vault exists', async () => {
    setupWalletRpc({ exists: true });

    const wrapper = await mountApp();

    expect(wrapper.text()).toContain('Unlock Wallet');
    expect(wrapper.text()).not.toContain('Confirm password');
    wrapper.unmount();
  });

  it('successful unlock hides the locked screen', async () => {
    setupWalletRpc({ exists: true });
    const wrapper = await mountApp();

    await wrapper.find('input[type="password"]').setValue(TEST_PASSWORD);
    await buttonByText(wrapper, 'Unlock wallet').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Unlock Wallet');
    expect(wrapper.find('nav[aria-label="Wallet sections"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('Add tab', () => {
  it('has one shared account name input', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Add account"]').trigger('click');

    expect(wrapper.text()).toContain('Account name');
    expect(wrapper.findAll('.add-name-field input')).toHaveLength(1);
    wrapper.unmount();
  });

  it('create account clears generated/import forms as expected', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Add account"]').trigger('click');
    await wrapper.find('.add-name-field input').setValue('Test account');
    await wrapper.find('textarea[placeholder="BIP-39 mnemonic"]').setValue(TEST_MNEMONIC);
    await wrapper.find('textarea[placeholder="Hex, base58, base64, or JSON byte array"]').setValue(TEST_ETH_PRIVATE_KEY);
    await buttonByText(wrapper, 'Create account').trigger('click');
    await flushPromises();
    await wrapper.find('button[aria-label="Add account"]').trigger('click');

    expect((wrapper.find('textarea[placeholder="BIP-39 mnemonic"]').element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('import mnemonic clears the textarea after success', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Add account"]').trigger('click');
    await wrapper.find('.add-name-field input').setValue('Test account');
    await wrapper.find('textarea[placeholder="BIP-39 mnemonic"]').setValue(TEST_MNEMONIC);
    await buttonByText(wrapper, 'Import').trigger('click');
    await flushPromises();
    await wrapper.find('button[aria-label="Add account"]').trigger('click');

    expect((wrapper.find('textarea[placeholder="BIP-39 mnemonic"]').element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('import private key clears the textarea after success', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Add account"]').trigger('click');
    await wrapper.find('.add-name-field input').setValue('Test account');
    await wrapper.find('textarea[placeholder="Hex, base58, base64, or JSON byte array"]').setValue(TEST_ETH_PRIVATE_KEY);
    await buttonByText(wrapper, 'Import private key').trigger('click');
    await flushPromises();
    await wrapper.find('button[aria-label="Add account"]').trigger('click');

    expect((wrapper.find('textarea[placeholder="Hex, base58, base64, or JSON byte array"]').element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('disables create and import actions until an account name is provided', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Add account"]').trigger('click');
    await wrapper.find('textarea[placeholder="BIP-39 mnemonic"]').setValue(TEST_MNEMONIC);
    await wrapper.find('textarea[placeholder="Hex, base58, base64, or JSON byte array"]').setValue(TEST_ETH_PRIVATE_KEY);

    expect(wrapper.text()).toContain('Account name is required');
    expect(buttonByText(wrapper, 'Create account').attributes('disabled')).toBeDefined();
    expect(buttonByText(wrapper, 'Import').attributes('disabled')).toBeDefined();
    expect(buttonByText(wrapper, 'Import private key').attributes('disabled')).toBeDefined();

    await wrapper.find('.add-name-field input').setValue('Test account');

    expect(wrapper.text()).not.toContain('Account name is required');
    expect(buttonByText(wrapper, 'Create account').attributes('disabled')).toBeUndefined();
    expect(buttonByText(wrapper, 'Import').attributes('disabled')).toBeUndefined();
    expect(buttonByText(wrapper, 'Import private key').attributes('disabled')).toBeUndefined();

    wrapper.unmount();
  });
});

describe('Settings tab', () => {
  it('toggles save immediately', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Settings"]').trigger('click');
    const row = wrapper.findAll('label.toggle-row').find(item => item.text().includes('Require password for message signing'))!;
    await row.find('input[type="checkbox"]').setValue(true);
    await flushPromises();

    expect(mockedCallThisAppService).toHaveBeenCalledWith(
      WALLET_INTERNAL_SERVICE_NAME,
      'updateSettings',
      { requirePasswordForMessageSigning: true },
    );
    wrapper.unmount();
  });

  it('reset wallet requires password and DELETE', async () => {
    setupWalletRpc({ exists: true, unlocked: true });
    const wrapper = await mountApp();

    await wrapper.find('button[aria-label="Settings"]').trigger('click');
    const dangerPanel = wrapper.find('.danger-panel');
    const deleteButton = buttonByText(wrapper, 'Delete vault');

    expect(dangerPanel.text()).toContain('Permanent action. Data cannot be recovered.');
    expect(deleteButton.attributes('disabled')).toBeDefined();

    const inputs = dangerPanel.findAll('input');
    await inputs[0].setValue(TEST_PASSWORD);
    await inputs[1].setValue('DELETE');

    expect(buttonByText(wrapper, 'Delete vault').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});
