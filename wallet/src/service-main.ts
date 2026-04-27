import { WALLET_SERVICE_NAME } from '@/lib/constants';
import { decodeJson, encodeJson } from '@/lib/json-rpc';
import { WalletService } from '@/lib/wallet-service';
import type {
  BalanceRequest,
  ImportMnemonicRequest,
  ImportPrivateKeyRequest,
  SignMessageRequest,
  SignTransactionRequest,
  TransferRequest,
  UnlockRequest,
} from '@/lib/types';

type CallStart = {
  msgType: 'start';
  callNum: number;
  method: string;
  data?: web3n.rpc.PassedDatum;
};

type IncomingConnection = web3n.rpc.Connection;

const service = new WalletService();

function statusEl(): HTMLElement | null {
  return document.getElementById('service-status');
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
  await w3n.log?.('error', `Wallet service ${context}`, err);
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

async function handleCall(connection: IncomingConnection, call: CallStart): Promise<void> {
  const { callNum, method, data } = call;
  updateStatus(`Wallet service handling ${method}...`);
  try {
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

async function bootstrapService(attempt = 0): Promise<void> {
  const runtime = w3n;
  if (!runtime?.rpc?.exposeService) {
    if (attempt === 0) {
      updateStatus('Wallet service waiting for runtime...');
    }
    if (attempt < 100) {
      window.setTimeout(() => {
        void bootstrapService(attempt + 1);
      }, 50);
    } else {
      await reportServiceError('runtime unavailable', 'w3n runtime was not injected into service component');
    }
    return;
  }

  try {
    await service.initialize();
    runtime.rpc.exposeService(WALLET_SERVICE_NAME, {
      next(connection) {
        updateStatus('Wallet service connected.');
        connection.watch({
          next: async message => {
            const call = message as Partial<CallStart>;
            if (call.msgType === 'start') {
              await handleCall(connection, call as CallStart);
            }
          },
          complete: () => {
            updateStatus('Wallet service waiting for requests.');
          },
          error: async err => {
            await reportServiceError('connection failed', err);
          },
        });
      },
      complete: () => {
        updateStatus('Wallet service stopped.');
      },
      error: async err => {
        await reportServiceError('failed to expose service', err);
      },
    });
    updateStatus('Wallet service waiting for requests.');
    await runtime.log?.('info', 'Wallet service exposed');
  } catch (err) {
    await reportServiceError('failed during startup', err);
  }
}

void bootstrapService();

window.addEventListener('error', event => {
  void reportServiceError('window error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', event => {
  void reportServiceError('unhandled rejection', event.reason);
});
