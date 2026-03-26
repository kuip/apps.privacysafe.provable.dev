import {
  get_record_by_hash,
  getRecordUrl,
  prove_single_hash,
  setKayrosHost,
} from '@kuip/provable-sdk';
import { readSettings, writeSettings } from '@/lib/settings';
import type {
  KayrosSettings,
  LookupRecordRequest,
  LookupRecordResult,
  RegisterHashRequest,
  RegisterHashResult,
} from '@/lib/types';
import { KAYROS_SERVICE_NAME } from '@/lib/constants';
import { decodeJson, encodeJson } from '@/lib/json-rpc';

function updateStatus(message: string): void {
  const el = document.querySelector('#service-status');
  if (el) {
    el.textContent = message;
  }
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
    setKayrosHost(resolved.kayrosHost);
    const response = await prove_single_hash(request.hash.trim(), {
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
      recordUrl: response.hash ? getRecordUrl(response.hash, resolved.dataType) : undefined,
    };
  }

  async lookupRecord(request: LookupRecordRequest): Promise<LookupRecordResult> {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    setKayrosHost(resolved.kayrosHost);
    const response = await get_record_by_hash(request.hash.trim(), {
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
      recordUrl: getRecordUrl(request.hash.trim(), resolved.dataType),
    };
  }
}

const service = new KayrosService();

async function handleCall(
  connection: web3n.rpc.service.IncomingConnection,
  call: web3n.rpc.service.CallStart,
): Promise<void> {
  const { callNum, method, data } = call;
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
  }
}

updateStatus('Kayros service starting…');

w3n.rpc!.exposeService!(KAYROS_SERVICE_NAME, {
  next(connection) {
    updateStatus('Kayros service ready');
    connection.watch({
      next: async call => {
        if (call.msgType === 'start') {
          await handleCall(connection, call);
        }
      },
      complete: () => {
        updateStatus('Kayros service idle');
      },
      error: async err => {
        updateStatus('Kayros service failed');
        await w3n.log?.('error', 'Kayros service connection failed', err);
      },
    });
  },
  complete: () => {
    updateStatus('Kayros service stopped');
  },
  error: async err => {
    updateStatus('Kayros service failed');
    await w3n.log?.('error', 'Kayros service failed to expose', err);
  },
});
