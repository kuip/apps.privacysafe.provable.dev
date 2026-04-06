import type {
  KayrosSettings,
  LookupDataItemRequest,
  LookupDataItemResult,
  LookupRecordRequest,
  LookupRecordResult,
  RegisterHashRequest,
  RegisterHashResult,
} from '@/lib/types';
import { readSettings, writeSettings } from '@/lib/settings';
import { KAYROS_SERVICE_NAME } from '@/lib/constants';
import { decodeJson, encodeJson } from '@/lib/json-rpc';

function updateStatus(message: string): void {
  document.title = message;
  const el = document.querySelector('#service-status');
  if (el) {
    el.textContent = message;
  }
}

function getW3N() {
  return (globalThis as typeof globalThis & { w3n?: typeof w3n }).w3n;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const extra = Object.entries(err as Error & Record<string, unknown>)
      .filter(([key]) => key !== 'message' && key !== 'stack' && key !== 'name')
      .reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});

    return Object.keys(extra).length > 0
      ? `${err.message} ${JSON.stringify(extra)}`
      : err.message;
  }

  if (typeof err === 'string') {
    return err;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function reportServiceError(context: string, err: unknown): Promise<void> {
  const detail = formatError(err);
  updateStatus(`Kayros service failed: ${detail}`);
  console.error(`Kayros service error: ${context}`, err);
  await getW3N()?.log?.('error', `Kayros service error: ${context}`, {
    detail,
    error: err,
  });
}

type ProvableSdkModule = typeof import('@kuip/provable-sdk');

let sdkPromise: Promise<ProvableSdkModule> | undefined;

async function getProvableSdk(): Promise<ProvableSdkModule> {
  if (!sdkPromise) {
    sdkPromise = import('@kuip/provable-sdk');
  }
  return await sdkPromise;
}

function setWaitingStatus(): void {
  updateStatus('Kayros service waiting for connection…');
}

function mergeSettings(base: KayrosSettings, overrides?: Partial<KayrosSettings>): KayrosSettings {
  return {
    kayrosHost: overrides?.kayrosHost?.trim() || base.kayrosHost,
    dataType: overrides?.dataType?.trim() || base.dataType,
    userKey: overrides?.userKey?.trim() || base.userKey,
  };
}

class KayrosService {
  async getSettings(): Promise<KayrosSettings> {
    return await readSettings();
  }

  async saveSettings(settings: Partial<KayrosSettings>): Promise<KayrosSettings> {
    return await writeSettings(settings);
  }

  async registerHash(request: RegisterHashRequest): Promise<RegisterHashResult> {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const sdk = await getProvableSdk();
    sdk.setKayrosHost(resolved.kayrosHost);
    const response = await sdk.prove_single_hash(request.hash.trim(), {
      dataType: resolved.dataType,
      apiKey: resolved.userKey || undefined,
    });

    return {
      request: {
        hash: request.hash.trim(),
        kayrosHost: resolved.kayrosHost,
        dataType: resolved.dataType,
      },
      response,
      recordUrl: response.hash ? sdk.getRecordUrl(response.hash, resolved.dataType) : undefined,
    };
  }

  async lookupRecord(request: LookupRecordRequest): Promise<LookupRecordResult> {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const sdk = await getProvableSdk();
    sdk.setKayrosHost(resolved.kayrosHost);
    const response = await sdk.get_record_by_hash(request.hash.trim(), {
      dataType: resolved.dataType,
      apiKey: resolved.userKey || undefined,
    });

    return {
      request: {
        hash: request.hash.trim(),
        kayrosHost: resolved.kayrosHost,
        dataType: resolved.dataType,
      },
      response,
      recordUrl: sdk.getRecordUrl(request.hash.trim(), resolved.dataType),
    };
  }

  async lookupDataItem(request: LookupDataItemRequest): Promise<LookupDataItemResult> {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const sdk = await getProvableSdk();
    sdk.setKayrosHost(resolved.kayrosHost);
    const response = await sdk.get_record_by_data_item(
      resolved.dataType,
      request.dataItem.trim(),
      {
        apiKey: resolved.userKey || undefined,
        limit: request.limit ?? 10,
      },
    );

    return {
      request: {
        dataItem: request.dataItem.trim(),
        limit: request.limit ?? 10,
        kayrosHost: resolved.kayrosHost,
        dataType: resolved.dataType,
      },
      response,
      recordUrls: response.records.map(record => sdk.getRecordUrl(record.hash_item, resolved.dataType)),
    };
  }
}

const service = new KayrosService();

async function handleCall(
  connection: web3n.rpc.service.IncomingConnection,
  call: web3n.rpc.service.CallStart,
): Promise<void> {
  const { callNum, method, data } = call;
  updateStatus(`Kayros service handling ${method}…`);
  try {
    if (method === 'getSettings') {
      await connection.send({
        callNum,
        callStatus: 'end',
        data: encodeJson(await service.getSettings()),
      });
      return;
    }

    if (method === 'saveSettings') {
      await connection.send({
        callNum,
        callStatus: 'end',
        data: encodeJson(await service.saveSettings(decodeJson<Partial<KayrosSettings>>(data))),
      });
      return;
    }

    if (method === 'registerHash') {
      await connection.send({
        callNum,
        callStatus: 'end',
        data: encodeJson(await service.registerHash(decodeJson<RegisterHashRequest>(data))),
      });
      return;
    }

    if (method === 'lookupRecord') {
      await connection.send({
        callNum,
        callStatus: 'end',
        data: encodeJson(await service.lookupRecord(decodeJson<LookupRecordRequest>(data))),
      });
      return;
    }

    if (method === 'lookupDataItem') {
      await connection.send({
        callNum,
        callStatus: 'end',
        data: encodeJson(await service.lookupDataItem(decodeJson<LookupDataItemRequest>(data))),
      });
      return;
    }

    await connection.send({
      callNum,
      callStatus: 'error',
      err: { message: `Unknown method ${method}` },
    });
  } catch (err) {
    await connection.send({
      callNum,
      callStatus: 'error',
      err: err instanceof Error ? { message: err.message } : err,
    });
  } finally {
    setWaitingStatus();
  }
}

function bootstrapService(attempt = 0): void {
  const runtime = getW3N();
  if (!runtime?.rpc?.exposeService) {
    if (attempt === 0) {
      updateStatus('Kayros service waiting for runtime…');
    }
    if (attempt < 100) {
      window.setTimeout(() => bootstrapService(attempt + 1), 50);
    } else {
      void reportServiceError('runtime unavailable', 'w3n runtime was not injected into service component');
    }
    return;
  }

  updateStatus('Kayros service registering…');

  try {
    runtime.rpc.exposeService(KAYROS_SERVICE_NAME, {
      next(connection) {
        updateStatus('Kayros service connected');
        connection.watch({
          next: async call => {
            if (call.msgType === 'start') {
              await handleCall(connection, call);
            }
          },
          complete: () => {
            setWaitingStatus();
          },
          error: async err => {
            await reportServiceError('connection failed', err);
          },
        });
      },
      complete: () => {
        updateStatus('Kayros service stopped');
      },
      error: async err => {
        await reportServiceError('failed to expose', err);
      },
    });
    setWaitingStatus();
    void runtime.log?.('info', 'Kayros service exposed');
  } catch (err) {
    void reportServiceError('failed during startup', err);
  }
}

bootstrapService();

window.addEventListener('error', event => {
  void reportServiceError('window error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', event => {
  void reportServiceError('unhandled rejection', event.reason);
});
