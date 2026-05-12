// @ts-nocheck

import { DEFAULT_SETTINGS, KAYROS_SERVICE_NAME, SETTINGS_FILE } from "../src/lib/constants.ts";

declare const w3n: any;

const SHA256_ALGORITHM = "SHA-256";
const KAYROS_REGISTER_RETRIES = 3;
const KAYROS_REGISTER_RETRY_DELAY_MS = 200;

const API_ROUTES = {
  PROVE_SINGLE_HASH: "/api/lightnet/grpc/single-hash",
  GET_RECORD_BY_HASH: "/api/lightnet/database/record-by-hash",
  GET_RECORD_BY_DATA_ITEM: "/api/lightnet/database/record",
} as const;

function logInfo(message: string, details?: unknown): void {
  console.log(`[kayros-service] ${message}`, details ?? "");
  void w3n?.log?.("info", message, details);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const extra = Object.entries(err as Error & Record<string, unknown>)
      .filter(([key]) => key !== "message" && key !== "stack" && key !== "name")
      .reduce<Record<string, unknown>>((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});

    return Object.keys(extra).length > 0
      ? `${err.message} ${JSON.stringify(extra)}`
      : err.message;
  }

  if (typeof err === "string") {
    return err;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function encodeJson(value: unknown) {
  return { bytes: new TextEncoder().encode(JSON.stringify(value ?? null)) };
}

function decodeJson<T>(datum: { bytes?: Uint8Array } | undefined): T {
  if (!datum?.bytes) {
    return undefined as T;
  }

  return JSON.parse(new TextDecoder().decode(datum.bytes)) as T;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createSha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.slice().buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return bytesToHex(new Uint8Array(digest));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function normalizeSettings(input?: Record<string, unknown> | null) {
  return {
    kayrosHost: (typeof input?.kayrosHost === "string" && input.kayrosHost.trim()) || DEFAULT_SETTINGS.kayrosHost,
    dataType: (typeof input?.dataType === "string" && input.dataType.trim()) || DEFAULT_SETTINGS.dataType,
    userKey: (typeof input?.userKey === "string" && input.userKey.trim()) || DEFAULT_SETTINGS.userKey,
  };
}

async function readSettings() {
  const fs = await w3n.storage.getAppLocalFS();
  try {
    const raw = await fs.readJSONFile(SETTINGS_FILE);
    return normalizeSettings(raw);
  } catch {
    return normalizeSettings();
  }
}

async function writeSettings(settings: Record<string, unknown>) {
  const normalized = normalizeSettings(settings);
  const fs = await w3n.storage.getAppLocalFS();
  await fs.writeJSONFile(SETTINGS_FILE, normalized);
  return normalized;
}

function mergeSettings(base: ReturnType<typeof normalizeSettings>, overrides?: Record<string, unknown>) {
  return {
    kayrosHost: (typeof overrides?.kayrosHost === "string" && overrides.kayrosHost.trim()) || base.kayrosHost,
    dataType: (typeof overrides?.dataType === "string" && overrides.dataType.trim()) || base.dataType,
    userKey: (typeof overrides?.userKey === "string" && overrides.userKey.trim()) || base.userKey,
  };
}

function resolveApiKey(userKey?: string): string {
  return userKey?.trim() || DEFAULT_SETTINGS.userKey;
}

function getDefaultHeaders(userKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Key": resolveApiKey(userKey),
  };
}

function formatDataTypeForQuery(dataType: string): string {
  const normalized = dataType.startsWith("0x") ? dataType.slice(2) : dataType;
  if (
    normalized.length > 0 &&
    normalized.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(normalized)
  ) {
    const bytes = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < normalized.length; i += 2) {
      const byte = Number.parseInt(normalized.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) {
        return dataType;
      }
      bytes[i / 2] = byte;
    }
    return new TextDecoder().decode(bytes);
  }

  return dataType;
}

function formatHashForQuery(hash: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(hash)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) {
      bytes[i / 2] = Number.parseInt(hash.slice(i, i + 2), 16);
    }

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  return hash;
}

function getKayrosUrl(host: string, route: string): string {
  return host.replace(/\/$/, "") + route;
}

function getRecordUrl(host: string, hash: string, dataType?: string): string {
  const dt = formatDataTypeForQuery(dataType ?? DEFAULT_SETTINGS.dataType);
  const recordHash = formatHashForQuery(hash);
  return `${host.replace(/\/$/, "")}${API_ROUTES.GET_RECORD_BY_HASH}?hash=${encodeURIComponent(recordHash)}&data_type=${encodeURIComponent(dt)}`;
}

async function proveSingleHash(
  host: string,
  dataHash: string,
  dataType: string,
  userKey?: string,
) {
  const response = await fetch(getKayrosUrl(host, API_ROUTES.PROVE_SINGLE_HASH), {
    method: "POST",
    headers: getDefaultHeaders(userKey),
    body: JSON.stringify({
      data_item: dataHash,
      data_type: dataType,
    }),
  });

  if (!response.ok) {
    throw new Error(`Kayros API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function getRecordByHash(
  host: string,
  recordHash: string,
  dataType: string,
  userKey?: string,
) {
  const formattedHash = formatHashForQuery(recordHash);
  const formattedDataType = formatDataTypeForQuery(dataType);
  const route = `${API_ROUTES.GET_RECORD_BY_HASH}?hash=${encodeURIComponent(formattedHash)}&data_type=${encodeURIComponent(formattedDataType)}`;
  const response = await fetch(getKayrosUrl(host, route), {
    method: "GET",
    headers: getDefaultHeaders(userKey),
  });

  if (!response.ok) {
    throw new Error(`Kayros API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function getRecordByDataItem(
  host: string,
  dataType: string,
  dataItem: string,
  userKey?: string,
  limit?: number,
) {
  let route = `${API_ROUTES.GET_RECORD_BY_DATA_ITEM}?data_type=${encodeURIComponent(dataType)}&data_item=${encodeURIComponent(dataItem)}`;
  if (typeof limit === "number" && limit > 0) {
    route += `&limit=${limit}`;
  }

  const response = await fetch(getKayrosUrl(host, route), {
    method: "GET",
    headers: getDefaultHeaders(userKey),
  });

  if (!response.ok) {
    throw new Error(`Kayros API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function ensureKayrosRegistrationSucceeded(result: any) {
  if (result.response.success && !result.response.error) {
    return result;
  }

  throw new Error(result.response.error || "Kayros rejected the registration request.");
}

function buildSuccessEntry(label: "content" | "metadata", hash: string, result: any) {
  return {
    label,
    status: "registered",
    algorithm: SHA256_ALGORITHM,
    hash,
    request: result.request,
    response: result.response,
    recordUrl: result.recordUrl,
  };
}

function buildFailedEntry(label: "content" | "metadata", hash: string, err: unknown) {
  return {
    label,
    status: "failed",
    algorithm: SHA256_ALGORITHM,
    hash,
    error: formatError(err),
  };
}

function resolveOverallStatus(content: any, metadata: any) {
  if (content.status === "registered" && metadata.status === "registered") {
    return "registered";
  }

  if (content.status === "failed" && metadata.status === "failed") {
    return "failed";
  }

  return "partial";
}

function getFolderPath(fullFilePath: string): string {
  const pathParts = fullFilePath.split("/");
  pathParts.pop();
  return pathParts.join("/") || "";
}

function buildSidecarFileName(originalName: string, kayrosHash: string): string {
  return `${originalName}_${kayrosHash}.json`;
}

function buildSidecarFilePath(fullFilePath: string, kayrosHash: string): string {
  const folderPath = getFolderPath(fullFilePath);
  const originalName = fullFilePath.split("/").pop() || "file";
  const sidecarName = buildSidecarFileName(originalName, kayrosHash);
  return folderPath ? `${folderPath}/${sidecarName}` : sidecarName;
}

function buildKayrosXAttrs(proof: any): Record<string, unknown> {
  return {
    kayros_version: proof.version,
    kayros_data_type: proof.content.request?.dataType || proof.metadata.request?.dataType || "",
    kayros_hash_item: {
      content: proof.content.response?.hash || "",
      metadata: proof.metadata.response?.hash || "",
    },
    kayros_data_item: {
      content: proof.content.hash,
      metadata: proof.metadata.hash,
    },
  };
}

class KayrosService {
  async getSettings() {
    return await readSettings();
  }

  async saveSettings(settings: Record<string, unknown>) {
    return await writeSettings(settings);
  }

  private async registerHashOnce(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const hash = String(request.hash ?? "").trim();
    const response = await proveSingleHash(
      resolved.kayrosHost,
      hash,
      resolved.dataType,
      resolved.userKey,
    );

    return {
      request: {
        hash,
        kayrosHost: resolved.kayrosHost,
        dataType: resolved.dataType,
      },
      response,
      recordUrl: response.hash ? getRecordUrl(resolved.kayrosHost, response.hash, resolved.dataType) : undefined,
    };
  }

  async registerHash(request: Record<string, unknown>) {
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
      : new Error("Kayros registration failed after retries.");
  }

  async lookupRecord(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const hash = String(request.hash ?? "").trim();
    const response = await getRecordByHash(
      resolved.kayrosHost,
      hash,
      resolved.dataType,
      resolved.userKey,
    );

    return {
      request: {
        hash,
        kayrosHost: resolved.kayrosHost,
        dataType: resolved.dataType,
      },
      response,
      recordUrl: getRecordUrl(resolved.kayrosHost, hash, resolved.dataType),
    };
  }

  async lookupDataItem(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const dataItem = String(request.dataItem ?? "").trim();
    const limit = typeof request.limit === "number" ? request.limit : 10;
    const response = await getRecordByDataItem(
      resolved.kayrosHost,
      resolved.dataType,
      dataItem,
      resolved.userKey,
      limit,
    );

    return {
      request: {
        dataItem,
        limit,
        kayrosHost: resolved.kayrosHost,
        dataType: resolved.dataType,
      },
      response,
      recordUrls: Array.isArray(response.records)
        ? response.records.map((record: any) => getRecordUrl(resolved.kayrosHost, record.hash_item, resolved.dataType))
        : [],
    };
  }

  async notarizeStoredFile(request: any, file: any, fs: any) {
    const fileBytes = await file.readBytes();
    if (!fileBytes) {
      throw new Error("Stored file is empty or unreadable.");
    }

    const [contentHash, metadataHash] = await Promise.all([
      createSha256Hex(fileBytes),
      createSha256Hex(new TextEncoder().encode(stableSerialize(request.metadataPayload))),
    ]);

    const [contentResult, metadataResult] = await Promise.allSettled([
      this.registerHash({ hash: contentHash }),
      this.registerHash({ hash: metadataHash }),
    ]);

    const content = contentResult.status === "fulfilled"
      ? buildSuccessEntry("content", contentHash, contentResult.value)
      : buildFailedEntry("content", contentHash, contentResult.reason);

    const metadata = metadataResult.status === "fulfilled"
      ? buildSuccessEntry("metadata", metadataHash, metadataResult.value)
      : buildFailedEntry("metadata", metadataHash, metadataResult.reason);

    const proof = {
      version: 1,
      status: resolveOverallStatus(content, metadata),
      uploadedAt: request.metadataPayload.uploadedAt,
      metadataPayload: request.metadataPayload,
      content,
      metadata,
    };

    if (proof.status !== "registered") {
      const detail = {
        file: file.name,
        fullFilePath: request.fullFilePath,
        proof,
      };
      console.warn("Skipping Kayros proof persistence because registration did not fully succeed.", detail);
      await w3n?.log?.("error", "Skipping Kayros proof persistence because registration did not fully succeed.", detail);
      return {
        status: proof.status,
        proofWritten: false,
      };
    }

    await file.updateXAttrs({
      set: buildKayrosXAttrs(proof),
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

async function handleCall(connection: any, call: any): Promise<void> {
  const { callNum, method, data } = call;
  try {
    if (method === "getSettings") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.getSettings()),
      });
      return;
    }

    if (method === "saveSettings") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.saveSettings(decodeJson<Record<string, unknown>>(data))),
      });
      return;
    }

    if (method === "registerHash") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.registerHash(decodeJson<Record<string, unknown>>(data))),
      });
      return;
    }

    if (method === "notarizeStoredFile") {
      const request = decodeJson<Record<string, unknown>>(data);
      const file = data?.passedByReference?.[0];
      const fs = data?.passedByReference?.[1];
      if (!file || !fs) {
        throw new Error("Kayros notarizeStoredFile requires passed file and fs references.");
      }
      const result = await service.notarizeStoredFile(request, file, fs);
      await connection.send({
        callNum,
        callStatus: "end",
        data: {
          ...encodeJson(result),
          passedByReference: [file],
        },
      });
      return;
    }

    if (method === "lookupRecord") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.lookupRecord(decodeJson<Record<string, unknown>>(data))),
      });
      return;
    }

    if (method === "lookupDataItem") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.lookupDataItem(decodeJson<Record<string, unknown>>(data))),
      });
      return;
    }

    await connection.send({
      callNum,
      callStatus: "error",
      err: { message: `Unknown method ${method}` },
    });
  } catch (err) {
    await connection.send({
      callNum,
      callStatus: "error",
      err: err instanceof Error ? { message: err.message } : err,
    });
  }
}

if (!w3n?.rpc?.exposeService) {
  throw new Error("Kayros service runtime was not injected.");
}

logInfo("Kayros Deno service registering");

w3n.rpc.exposeService(KAYROS_SERVICE_NAME, {
  next(connection: any) {
    logInfo("Kayros Deno service connected");
    connection.watch({
      next: async (call: any) => {
        if (call.msgType === "start") {
          await handleCall(connection, call);
        }
      },
      complete: () => {
        logInfo("Kayros Deno service waiting");
      },
      error: async (err: unknown) => {
        await w3n?.log?.("error", "Kayros Deno service connection failed", {
          detail: formatError(err),
          error: err,
        });
      },
    });
  },
  complete: () => {
    logInfo("Kayros Deno service stopped");
    w3n.closeSelf?.();
  },
  error: async (err: unknown) => {
    await w3n?.log?.("error", "Kayros Deno service failed to expose", {
      detail: formatError(err),
      error: err,
    });
    w3n.closeSelf?.();
  },
});

logInfo("Kayros Deno service exposed");
