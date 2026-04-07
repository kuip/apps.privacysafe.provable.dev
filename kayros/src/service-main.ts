import type {
  KayrosSettings,
  KayrosNotaryEntry,
  KayrosUploadProof,
  KayrosUploadStatus,
  LookupDataItemRequest,
  LookupDataItemResult,
  LookupRecordRequest,
  LookupRecordResult,
  NotarizeStoredFileRequest,
  NotarizeStoredFileResult,
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

const KAYROS_NOTARY_XATTR_NAME = 'kayros-notary-v1';
const SHA256_ALGORITHM = 'SHA-256';
const KAYROS_REGISTER_RETRIES = 3;
const KAYROS_REGISTER_RETRY_DELAY_MS = 200;

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function createSha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.slice().buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function ensureKayrosRegistrationSucceeded(result: RegisterHashResult): RegisterHashResult {
  if (result.response.success && !result.response.error) {
    return result;
  }

  throw new Error(result.response.error || 'Kayros rejected the registration request.');
}

function buildSuccessEntry(
  label: KayrosNotaryEntry['label'],
  hash: string,
  result: RegisterHashResult,
): KayrosNotaryEntry {
  return {
    label,
    status: 'registered',
    algorithm: SHA256_ALGORITHM,
    hash,
    request: result.request,
    response: result.response,
    recordUrl: result.recordUrl,
  };
}

function buildFailedEntry(
  label: KayrosNotaryEntry['label'],
  hash: string,
  err: unknown,
): KayrosNotaryEntry {
  return {
    label,
    status: 'failed',
    algorithm: SHA256_ALGORITHM,
    hash,
    error: formatError(err),
  };
}

function resolveOverallStatus(
  content: KayrosNotaryEntry,
  metadata: KayrosNotaryEntry,
): KayrosUploadStatus {
  if (content.status === 'registered' && metadata.status === 'registered') {
    return 'registered';
  }

  if (content.status === 'failed' && metadata.status === 'failed') {
    return 'failed';
  }

  return 'partial';
}

function getFolderPath(fullFilePath: string): string {
  const pathParts = fullFilePath.split('/');
  pathParts.pop();
  return pathParts.join('/') || '';
}

function buildSidecarFileName(originalName: string, kayrosHash: string): string {
  return `${originalName}_${kayrosHash}.json`;
}

function buildSidecarFilePath(fullFilePath: string, kayrosHash: string): string {
  const folderPath = getFolderPath(fullFilePath);
  const originalName = fullFilePath.split('/').pop() || 'file';
  const sidecarName = buildSidecarFileName(originalName, kayrosHash);
  return folderPath ? `${folderPath}/${sidecarName}` : sidecarName;
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

  private async registerHashOnce(request: RegisterHashRequest): Promise<RegisterHashResult> {
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

  async registerHash(request: RegisterHashRequest): Promise<RegisterHashResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= KAYROS_REGISTER_RETRIES; attempt += 1) {
      try {
        const result = await this.registerHashOnce(request);
        return ensureKayrosRegistrationSucceeded(result);
      } catch (err) {
        lastError = err;
        if (attempt < KAYROS_REGISTER_RETRIES) {
          await sleep(KAYROS_REGISTER_RETRY_DELAY_MS);
        }
      }
    }

    throw (lastError instanceof Error)
      ? lastError
      : new Error('Kayros registration failed after retries.');
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

  async notarizeStoredFile(
    request: NotarizeStoredFileRequest,
    file: web3n.files.WritableFile,
    fs: web3n.files.WritableFS,
  ): Promise<NotarizeStoredFileResult> {
    const fileBytes = await file.readBytes();
    if (!fileBytes) {
      throw new Error('Stored file is empty or unreadable.');
    }

    const [contentHash, metadataHash] = await Promise.all([
      createSha256Hex(fileBytes),
      createSha256Hex(new TextEncoder().encode(stableSerialize(request.metadataPayload))),
    ]);

    const [contentResult, metadataResult] = await Promise.allSettled([
      this.registerHash({ hash: contentHash }),
      this.registerHash({ hash: metadataHash }),
    ]);

    const content = contentResult.status === 'fulfilled'
      ? buildSuccessEntry('content', contentHash, contentResult.value)
      : buildFailedEntry('content', contentHash, contentResult.reason);

    const metadata = metadataResult.status === 'fulfilled'
      ? buildSuccessEntry('metadata', metadataHash, metadataResult.value)
      : buildFailedEntry('metadata', metadataHash, metadataResult.reason);

    const proof: KayrosUploadProof = {
      version: 1,
      status: resolveOverallStatus(content, metadata),
      uploadedAt: request.metadataPayload.uploadedAt,
      metadataPayload: request.metadataPayload,
      content,
      metadata,
    };

    if (proof.status !== 'registered') {
      const detail = {
        file: file.name,
        fullFilePath: request.fullFilePath,
        proof,
      };
      console.warn('Skipping Kayros proof persistence because registration did not fully succeed.', detail);
      await getW3N()?.log?.('error', 'Skipping Kayros proof persistence because registration did not fully succeed.', detail);
      return {
        status: proof.status,
        proofWritten: false,
      };
    }

    await file.updateXAttrs({
      set: {
        [KAYROS_NOTARY_XATTR_NAME]: proof,
      },
    });

    const sidecarHash = proof.content.response?.hash || proof.content.hash;
    const sidecarPath = buildSidecarFilePath(request.fullFilePath, sidecarHash);
    await fs.writeJSONFile(sidecarPath, proof);

    return {
      status: proof.status,
      proofWritten: true,
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

    if (method === 'notarizeStoredFile') {
      const request = decodeJson<NotarizeStoredFileRequest>(data);
      const file = data?.passedByReference?.[0] as web3n.files.WritableFile | undefined;
      const fs = data?.passedByReference?.[1] as web3n.files.WritableFS | undefined;
      if (!file || !fs) {
        throw new Error('Kayros notarizeStoredFile requires passed file and fs references.');
      }
      const result = await service.notarizeStoredFile(request, file, fs);
      await connection.send({
        callNum,
        callStatus: 'end',
        data: {
          ...encodeJson(result),
          passedByReference: [file],
        },
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
