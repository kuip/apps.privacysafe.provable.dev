import { WALLET_INTERNAL_SERVICE_NAME, WALLET_SERVICE_NAME } from '@/lib/constants';
import { decodeJson, encodeJson } from '@/lib/json-rpc';
import { WalletService } from '@/lib/wallet-service';
import type {
  BalanceRequest,
  ChangePassphraseRequest,
  ImportMnemonicRequest,
  ImportPrivateKeyRequest,
  ResetVaultRequest,
  RevealRecoveryPhraseRequest,
  SignMessageRequest,
  SignTransactionRequest,
  TransferRequest,
  UnlockRequest,
  WalletSettings,
} from '@/lib/types';

type CallStart = {
  msgType: 'start';
  callNum: number;
  method: string;
  data?: web3n.rpc.PassedDatum;
};

type IncomingConnection = web3n.rpc.Connection;

const service = new WalletService();
const internalMethods = new Set([
  'status',
  'createMnemonic',
  'unlock',
  'lock',
  'getPublicState',
  'listAccounts',
  'updateSettings',
  'changePassphrase',
  'resetVault',
  'revealRecoveryPhrase',
  'importMnemonic',
  'importPrivateKey',
  'getBalance',
  'transfer',
  'signMessage',
  'signTransaction',
]);
const externalMethods = new Set([
  'getPublicState',
  'listAccounts',
  'getBalance',
  'transfer',
  'signMessage',
  'signTransaction',
]);

type RuntimeGlobal = typeof globalThis & {
  document?: Document;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  w3n?: typeof w3n;
};

function runtimeGlobal(): RuntimeGlobal {
  return globalThis as RuntimeGlobal;
}

function runtimeW3n(): typeof w3n | undefined {
  return runtimeGlobal().w3n;
}

function statusEl(): HTMLElement | null {
  return runtimeGlobal().document?.getElementById('service-status') ?? null;
}

function updateStatus(message: string): void {
  const el = statusEl();
  if (el) {
    el.textContent = message;
  }
}

async function reportServiceError(context: string, err: unknown): Promise<void> {
  updateStatus(`Wallet service error: ${context}`);
  console.error(context, err);
  await runtimeW3n()?.log?.('error', `Wallet service ${context}`, err);
}

async function callMethod(method: string, data: web3n.rpc.PassedDatum | undefined): Promise<unknown> {
  switch (method) {
    case 'status':
      return service.status();
    case 'createMnemonic':
      return service.createMnemonic();
    case 'unlock':
      return service.unlock(decodeJson<UnlockRequest>(data));
    case 'lock':
      return service.lock();
    case 'getPublicState':
      return service.getPublicState();
    case 'listAccounts':
      return service.listAccounts();
    case 'updateSettings':
      return service.updateSettings(decodeJson<Partial<WalletSettings>>(data));
    case 'changePassphrase':
      return service.changePassphrase(decodeJson<ChangePassphraseRequest>(data));
    case 'resetVault':
      return service.resetVault(decodeJson<ResetVaultRequest>(data));
    case 'revealRecoveryPhrase':
      return service.revealRecoveryPhrase(decodeJson<RevealRecoveryPhraseRequest>(data));
    case 'importMnemonic':
      return service.importMnemonic(decodeJson<ImportMnemonicRequest>(data));
    case 'importPrivateKey':
      return service.importPrivateKey(decodeJson<ImportPrivateKeyRequest>(data));
    case 'getBalance':
      return service.getBalance(decodeJson<BalanceRequest>(data));
    case 'transfer':
      return service.transfer(decodeJson<TransferRequest>(data));
    case 'signMessage':
      return service.signMessage(decodeJson<SignMessageRequest>(data));
    case 'signTransaction':
      return service.signTransaction(decodeJson<SignTransactionRequest>(data));
    default:
      throw new Error(`Unknown method ${method}`);
  }
}

async function handleCall(
  serviceName: string,
  allowedMethods: Set<string>,
  connection: IncomingConnection,
  call: CallStart,
): Promise<void> {
  const { callNum, method, data } = call;
  updateStatus(`${serviceName} handling ${method}...`);
  try {
    if (!allowedMethods.has(method)) {
      throw new Error(`Method ${method} is not exposed by ${serviceName}.`);
    }
    const result = await callMethod(method, data);
    await connection.send({
      callNum,
      callStatus: 'end',
      data: encodeJson(result),
    });
  } catch (err) {
    await connection.send({
      callNum,
      callStatus: 'error',
      err: err instanceof Error ? { message: err.message } : err,
    });
  } finally {
    updateStatus('Wallet service waiting for requests.');
  }
}

function exposeWalletService(serviceName: string, allowedMethods: Set<string>): void {
  runtimeW3n()?.rpc!.exposeService!(serviceName, {
    next(connection) {
      updateStatus(`${serviceName} connected.`);
      connection.watch({
        next: async message => {
          const call = message as Partial<CallStart>;
          if (call.msgType === 'start') {
            await handleCall(serviceName, allowedMethods, connection, call as CallStart);
          }
        },
        complete: () => {
          updateStatus('Wallet service waiting for requests.');
        },
        error: async err => {
          await reportServiceError(`${serviceName} connection failed`, err);
        },
      });
    },
    complete: () => {
      updateStatus(`${serviceName} stopped.`);
    },
    error: async err => {
      await reportServiceError(`failed to expose ${serviceName}`, err);
    },
  });
}

async function bootstrapService(attempt = 0): Promise<void> {
  const runtime = runtimeW3n();
  if (!runtime?.rpc?.exposeService) {
    if (attempt === 0) {
      updateStatus('Wallet service waiting for runtime...');
    }
    if (attempt < 100) {
      setTimeout(() => {
        void bootstrapService(attempt + 1);
      }, 50);
    } else {
      await reportServiceError('runtime unavailable', 'w3n runtime was not injected into service component');
    }
    return;
  }

  try {
    await service.initialize();
    exposeWalletService(WALLET_INTERNAL_SERVICE_NAME, internalMethods);
    exposeWalletService(WALLET_SERVICE_NAME, externalMethods);
    updateStatus('Wallet service waiting for requests.');
    await runtime.log?.('info', 'Wallet services exposed');
  } catch (err) {
    await reportServiceError('failed during startup', err);
  }
}

void bootstrapService();

runtimeGlobal().addEventListener?.('error', event => {
  const errorEvent = event as ErrorEvent;
  void reportServiceError('runtime error', errorEvent.error ?? errorEvent.message ?? event);
});

runtimeGlobal().addEventListener?.('unhandledrejection', event => {
  void reportServiceError('unhandled rejection', (event as PromiseRejectionEvent).reason ?? event);
});
