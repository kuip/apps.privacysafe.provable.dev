// @ts-nocheck

import { DEFAULT_SETTINGS, KAYROS_SERVICE_NAME, PROOFS_INDEX_FILE, PROOFS_ROOT_FOLDER, SETTINGS_FILE } from "../src/lib/constants.ts";

declare const w3n: any;

const SHA256_ALGORITHM = "SHA-256";
const KAYROS_REGISTER_RETRIES = 3;
const KAYROS_REGISTER_RETRY_DELAY_MS = 200;
const KAYROS_MERKLE_FETCH_DELAYS_MS = [10_000, 20_000] as const;
const UUID_GREGORIAN_EPOCH = 122192928000000000n;

const API_ROUTES = {
  PROVE_SINGLE_HASH: "/api/lightnet/grpc/single-hash",
  GET_RECORD_BY_HASH: "/api/lightnet/database/record-by-hash",
  GET_RECORD_BY_DATA_ITEM: "/api/lightnet/database/record",
  GET_MERKLE_PROOF: "/api/lightnet/merkle-proof",
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

function decodeJsonObject(data: { bytes?: Uint8Array } | undefined): Record<string, unknown> {
  const decoded = decodeJson<Record<string, unknown> | null | undefined>(data);
  return (decoded && typeof decoded === "object") ? decoded : {};
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

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    return new Uint8Array(0);
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
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

function scheduleAfter(ms: number, fn: () => void): void {
  setTimeout(fn, ms);
}

function timeuuidToTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const normalized = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    return undefined;
  }

  const bytes = hexToBytes(normalized);
  if (bytes.length !== 16) {
    return undefined;
  }

  const timeLow = (BigInt(bytes[0]) << 24n)
    | (BigInt(bytes[1]) << 16n)
    | (BigInt(bytes[2]) << 8n)
    | BigInt(bytes[3]);
  const timeMid = (BigInt(bytes[4]) << 8n) | BigInt(bytes[5]);
  const timeHi = ((BigInt(bytes[6]) << 8n) | BigInt(bytes[7])) & 0x0fffn;
  const timestamp = timeLow | (timeMid << 32n) | (timeHi << 48n);
  const unixNanos = (timestamp - UUID_GREGORIAN_EPOCH) * 100n;
  const unixMillis = Number(unixNanos / 1_000_000n);

  if (!Number.isFinite(unixMillis)) {
    return undefined;
  }

  return new Date(unixMillis).toISOString();
}

function resolveProofCreatedAt(proof: any): string | undefined {
  const uploadedAt = proof?.uploadedAt || proof?.metadataPayload?.uploadedAt;
  if (typeof uploadedAt === "string" && uploadedAt.trim()) {
    return uploadedAt;
  }

  return timeuuidToTimestamp(
    proof?.content?.response?.timeuuid
    || proof?.metadata?.response?.timeuuid,
  );
}

function resolveArchiveCreatedAt(request: any, proof: any): string {
  const fromRequest = request?.metadataPayload?.uploadedAt;
  if (typeof fromRequest === "string" && fromRequest.trim()) {
    return fromRequest;
  }

  const fromProof = resolveProofCreatedAt(proof);
  if (typeof fromProof === "string" && fromProof.trim()) {
    return fromProof;
  }

  return new Date().toISOString();
}

function normalizeSettings(input?: Record<string, unknown> | null) {
  return {
    kayrosHost: (typeof input?.kayrosHost === "string" && input.kayrosHost.trim()) || DEFAULT_SETTINGS.kayrosHost,
    dataType: (typeof input?.dataType === "string" && input.dataType.trim()) || DEFAULT_SETTINGS.dataType,
    userKey: (typeof input?.userKey === "string" && input.userKey.trim()) || DEFAULT_SETTINGS.userKey,
    saveMerkleProofs: typeof input?.saveMerkleProofs === "boolean"
      ? input.saveMerkleProofs
      : DEFAULT_SETTINGS.saveMerkleProofs,
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

async function deleteSettingsFile() {
  const fs = await w3n.storage.getAppLocalFS();
  try {
    await fs.deleteFile(SETTINGS_FILE);
  } catch {
    // ignore missing settings file
  }
}

function mergeSettings(base: ReturnType<typeof normalizeSettings>, overrides?: Record<string, unknown>) {
  return {
    kayrosHost: (typeof overrides?.kayrosHost === "string" && overrides.kayrosHost.trim()) || base.kayrosHost,
    dataType: (typeof overrides?.dataType === "string" && overrides.dataType.trim()) || base.dataType,
    userKey: (typeof overrides?.userKey === "string" && overrides.userKey.trim()) || base.userKey,
    saveMerkleProofs: typeof overrides?.saveMerkleProofs === "boolean"
      ? overrides.saveMerkleProofs
      : base.saveMerkleProofs,
  };
}

function normalizeFolderSegment(segment: string): string {
  const sanitized = segment
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
  return sanitized || DEFAULT_SETTINGS.dataType;
}

function buildProofArchivePaths(dataType: string, contentHash: string) {
  const dataTypeFolder = normalizeFolderSegment(dataType);
  return {
    dataTypeFolder,
    proofFileName: `${contentHash}_proof.json`,
    merkleProofFileName: `${contentHash}_merkle-proof.json`,
    metaFileName: `${contentHash}_meta.json`,
    proofPath: `${dataTypeFolder}/${contentHash}_proof.json`,
    merkleProofPath: `${dataTypeFolder}/${contentHash}_merkle-proof.json`,
    metaPath: `${dataTypeFolder}/${contentHash}_meta.json`,
  };
}

async function getProofsRootFS() {
  const fs = await w3n.storage.getAppSyncedFS();
  return await fs.writableSubRoot(PROOFS_ROOT_FOLDER);
}

type ProofIndexEntry = {
  dataType: string;
  contentHash: string;
  createdAt?: string;
  hasProof: boolean;
  hasMerkleProof: boolean;
  hasMeta: boolean;
};

async function readProofIndex(): Promise<ProofIndexEntry[]> {
  const proofsFs = await getProofsRootFS();
  try {
    const raw = await proofsFs.readJSONFile(PROOFS_INDEX_FILE);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeProofIndex(entries: ProofIndexEntry[]): Promise<void> {
  const proofsFs = await getProofsRootFS();
  await proofsFs.writeJSONFile(PROOFS_INDEX_FILE, entries);
}

function upsertProofIndexEntry(
  entries: ProofIndexEntry[],
  nextEntry: ProofIndexEntry,
): ProofIndexEntry[] {
  const index = entries.findIndex(entry => (
    entry.dataType === nextEntry.dataType
    && entry.contentHash === nextEntry.contentHash
  ));
  if (index >= 0) {
    const merged = { ...entries[index], ...nextEntry };
    entries.splice(index, 1, merged);
    return entries;
  }

  entries.push(nextEntry);
  return entries;
}

function removeProofIndexEntry(
  entries: ProofIndexEntry[],
  dataType: string,
  contentHash: string,
): ProofIndexEntry[] {
  return entries.filter(entry => !(
    entry.dataType === dataType
    && entry.contentHash === contentHash
  ));
}

async function clearFolderContents(fs: any, path = ""): Promise<void> {
  const entries = await listFolderIfPresent(fs, path);
  for (const entry of entries) {
    if (!entry?.name) {
      continue;
    }

    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isFolder) {
      await clearFolderContents(fs, entryPath);
      await fs.deleteFolder(entryPath);
    } else {
      await fs.deleteFile(entryPath);
    }
  }
}

async function deleteProofsRoot() {
  const proofsFs = await getProofsRootFS();
  const entries = await readProofIndex();

  for (const entry of entries) {
    const archivePaths = buildProofArchivePaths(entry.dataType, entry.contentHash);
    if (entry.hasProof) {
      await proofsFs.deleteFile(archivePaths.proofPath).catch(() => {});
    }
    if (entry.hasMeta) {
      await proofsFs.deleteFile(archivePaths.metaPath).catch(() => {});
    }
    if (entry.hasMerkleProof) {
      await proofsFs.deleteFile(archivePaths.merkleProofPath).catch(() => {});
    }
  }

  await proofsFs.deleteFile(PROOFS_INDEX_FILE).catch(() => {});
  logInfo("Cleared Kayros archived proofs root");
}

async function readJSONIfPresent(fs: any, path: string) {
  try {
    return await fs.readJSONFile(path);
  } catch {
    return undefined;
  }
}

async function listFolderIfPresent(fs: any, path: string) {
  try {
    return await fs.listFolder(path);
  } catch {
    return [];
  }
}

async function storeArchivedProofBundle(
  dataType: string,
  contentHash: string,
  proof: any,
  meta: any,
  merkleProof: any | undefined,
) {
  const rootFs = await getProofsRootFS();
  const archivePaths = buildProofArchivePaths(dataType, contentHash);
  const folderFs = await rootFs.writableSubRoot(archivePaths.dataTypeFolder);

  await folderFs.writeJSONFile(archivePaths.proofFileName, proof);
  await folderFs.writeJSONFile(archivePaths.metaFileName, meta);

  if (merkleProof !== undefined) {
    await folderFs.writeJSONFile(archivePaths.merkleProofFileName, merkleProof);
  }

  const indexEntries = await readProofIndex();
  await writeProofIndex(upsertProofIndexEntry(indexEntries, {
    dataType,
    contentHash,
    createdAt: meta?.createdAt,
    hasProof: true,
    hasMerkleProof: merkleProof !== undefined,
    hasMeta: true,
  }));
}

async function storeArchivedMerkleProof(
  dataType: string,
  contentHash: string,
  merkleProof: any,
) {
  const rootFs = await getProofsRootFS();
  const archivePaths = buildProofArchivePaths(dataType, contentHash);
  const folderFs = await rootFs.writableSubRoot(archivePaths.dataTypeFolder);
  await folderFs.writeJSONFile(archivePaths.merkleProofFileName, merkleProof);

  const indexEntries = await readProofIndex();
  await writeProofIndex(upsertProofIndexEntry(indexEntries, {
    dataType,
    contentHash,
    hasProof: true,
    hasMerkleProof: true,
    hasMeta: true,
  }));
}

async function loadArchivedProofBundle(dataType: string, contentHash: string) {
  const rootFs = await getProofsRootFS();
  const archivePaths = buildProofArchivePaths(dataType, contentHash);

  const [proof, merkleProof, meta] = await Promise.all([
    readJSONIfPresent(rootFs, archivePaths.proofPath),
    readJSONIfPresent(rootFs, archivePaths.merkleProofPath),
    readJSONIfPresent(rootFs, archivePaths.metaPath),
  ]);

  return {
    dataType,
    contentHash,
    proof,
    merkleProof,
    meta,
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

async function getMerkleProof(
  host: string,
  dataType: string,
  hashItem: string,
  userKey?: string,
) {
  const route = `${API_ROUTES.GET_MERKLE_PROOF}?data_type=${encodeURIComponent(dataType)}&hash=${encodeURIComponent(hashItem)}`;
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

function ensureMerkleProofSucceeded(result: any) {
  if (result?.success && !result?.error) {
    return result;
  }

  throw new Error(result?.error || result?.message || "Kayros rejected the merkle proof request.");
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

  async deleteKayrosData() {
    await Promise.all([
      deleteSettingsFile(),
      deleteProofsRoot(),
    ]);

    return { deleted: true };
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

  private async fetchMerkleProofsForProof(proof: any, userKey?: string) {
    const contentRequest = proof.content?.request;
    const metadataRequest = proof.metadata?.request;
    const contentHashItem = proof.content?.response?.hash;
    const metadataHashItem = proof.metadata?.response?.hash;

    if (!contentRequest?.kayrosHost || !contentRequest?.dataType || !contentHashItem) {
      throw new Error("Missing content registration data needed to fetch Merkle proof.");
    }

    if (!metadataRequest?.kayrosHost || !metadataRequest?.dataType || !metadataHashItem) {
      throw new Error("Missing metadata registration data needed to fetch Merkle proof.");
    }

    const [contentMerkle, metadataMerkle] = await Promise.all([
      getMerkleProof(
        contentRequest.kayrosHost,
        contentRequest.dataType,
        contentHashItem,
        userKey,
      ).then(ensureMerkleProofSucceeded),
      getMerkleProof(
        metadataRequest.kayrosHost,
        metadataRequest.dataType,
        metadataHashItem,
        userKey,
      ).then(ensureMerkleProofSucceeded),
    ]);

    return {
      version: 1,
      content: contentMerkle,
      metadata: metadataMerkle,
    };
  }

  private scheduleMerkleProofPersistence(
    proof: any,
    contentHash: string,
    dataType: string,
    fullFilePath: string,
    userKey?: string,
  ) {
    let accumulatedDelay = 0;
    let completed = false;

    for (const [index, delayMs] of KAYROS_MERKLE_FETCH_DELAYS_MS.entries()) {
      accumulatedDelay += delayMs;
      const attempt = index + 1;
      const scheduledDelay = accumulatedDelay;

      scheduleAfter(scheduledDelay, () => {
        void (async () => {
          if (completed) {
            return;
          }

          try {
            const merkleProof = await this.fetchMerkleProofsForProof(proof, userKey);
            await storeArchivedMerkleProof(dataType, contentHash, merkleProof);
            completed = true;
            logInfo("Stored Kayros delayed Merkle proof bundle", {
              attempt,
              dataType,
              contentHash,
              fullFilePath,
            });
          } catch (err) {
            const detail = {
              attempt,
              delayMs: scheduledDelay,
              file: fullFilePath.split("/").pop() || "",
              fullFilePath,
              error: formatError(err),
            };
            console.warn("Failed to fetch delayed Kayros Merkle proof after registration.", detail);
            await w3n?.log?.("error", "Failed to fetch delayed Kayros Merkle proof after registration.", detail);
          }
        })();
      });
    }
  }

  async getProofFile(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    return bundle.proof;
  }

  async getMerkleProofFile(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    return bundle.merkleProof;
  }

  async getProofMeta(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    return bundle.meta;
  }

  async saveMerkleProofFile(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    if (!contentHash) {
      throw new Error("Missing contentHash for saveMerkleProofFile.");
    }
    if (!("merkleProof" in request)) {
      throw new Error("Missing merkleProof payload for saveMerkleProofFile.");
    }

    await storeArchivedMerkleProof(
      resolved.dataType,
      contentHash,
      request.merkleProof,
    );

    return {
      dataType: resolved.dataType,
      contentHash,
      saved: true,
    };
  }

  async listProofs(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const indexedEntries = await readProofIndex();
    const filteredEntries = (
      typeof request.dataType === "string" && request.dataType.trim()
        ? indexedEntries.filter(entry => entry.dataType === resolved.dataType)
        : indexedEntries
    );

    const response = {
      dataType: typeof request.dataType === "string" && request.dataType.trim()
        ? resolved.dataType
        : "",
      entries: filteredEntries.sort((left, right) => {
        const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NEGATIVE_INFINITY;
        const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NEGATIVE_INFINITY;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        if (left.dataType !== right.dataType) {
          return left.dataType.localeCompare(right.dataType);
        }
        return left.contentHash.localeCompare(right.contentHash);
      }),
    };

    logInfo("Listed Kayros archived proofs", {
      requestedDataType: response.dataType || null,
      count: response.entries.length,
    });

    return response;
  }

  async notarizeStoredFile(request: any, file: any) {
    const stored = await readSettings();
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

    const archivedAt = resolveArchiveCreatedAt(request, {
      content: contentResult.status === "fulfilled" ? contentResult.value : undefined,
      metadata: metadataResult.status === "fulfilled" ? metadataResult.value : undefined,
    });

    const proof = {
      version: 1,
      status: resolveOverallStatus(content, metadata),
      uploadedAt: archivedAt,
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

    const archivedDataType = proof.content.request?.dataType || proof.metadata.request?.dataType || stored.dataType;
    try {
      await storeArchivedProofBundle(
        archivedDataType,
        proof.content.hash,
        proof,
        {
          createdAt: archivedAt,
          currentFilePath: request.fullFilePath,
          fsId: typeof request.fsId === "string" ? request.fsId : null,
          originalFilename: request.metadataPayload.originalName,
        },
        undefined,
      );
      logInfo("Stored Kayros archived proof bundle", {
        dataType: archivedDataType,
        contentHash: proof.content.hash,
        fullFilePath: request.fullFilePath,
        hasMerkleProof: false,
      });
    } catch (err) {
      const detail = {
        file: file.name,
        fullFilePath: request.fullFilePath,
        error: formatError(err),
      };
      console.warn("Failed to store Kayros archived proof bundle.", detail);
      await w3n?.log?.("error", "Failed to store Kayros archived proof bundle.", detail);
      return {
        status: proof.status,
        proofWritten: false,
      };
    }

    if (stored.saveMerkleProofs) {
      this.scheduleMerkleProofPersistence(
        proof,
        proof.content.hash,
        archivedDataType,
        request.fullFilePath,
        stored.userKey,
      );
    }

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
        data: encodeJson(await service.saveSettings(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "deleteKayrosData") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.deleteKayrosData()),
      });
      return;
    }

    if (method === "registerHash") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.registerHash(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "notarizeStoredFile") {
      const request = decodeJsonObject(data);
      const file = data?.passedByReference?.[0];
      if (!file) {
        throw new Error("Kayros notarizeStoredFile requires a passed file reference.");
      }
      const result = await service.notarizeStoredFile(request, file);
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(result),
      });
      return;
    }

    if (method === "lookupRecord") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.lookupRecord(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "lookupDataItem") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.lookupDataItem(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "getProofFile") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.getProofFile(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "getMerkleProofFile") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.getMerkleProofFile(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "getProofMeta") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.getProofMeta(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "saveMerkleProofFile") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.saveMerkleProofFile(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "listProofs") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.listProofs(decodeJsonObject(data))),
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
