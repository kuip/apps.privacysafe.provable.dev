// @ts-nocheck

import {
  checkMerkleProofCompatibility,
  setKayrosHost,
  verifyMerkleProof,
  verifyWithInclusion,
} from "@kuip/provable-sdk";
import { KayrosEnvelope } from "@kuip/provable-proof";
import { DEFAULT_SETTINGS, KAYROS_SERVICE_NAME, PROOFS_INDEX_FILE, PROOFS_ROOT_FOLDER, SETTINGS_FILE } from "../src/lib/constants.ts";

declare const w3n: any;

const SHA256_ALGORITHM = "SHA-256";
const KAYROS_REGISTER_RETRIES = 3;
const KAYROS_REGISTER_RETRY_DELAY_MS = 200;
const KAYROS_MERKLE_FETCH_DELAYS_MS = [10_000, 20_000] as const;
const KAYROS_RECORD_FETCH_ATTEMPTS = 3;
const KAYROS_RECORD_FETCH_INITIAL_DELAY_MS = 1_000;
const KAYROS_RECORD_FETCH_RETRY_DELAY_MS = 3_000;
const UUID_GREGORIAN_EPOCH = 122192928000000000n;
const PROVABLE_SDK_SERVICE = "@kuip/provable-sdk@0.1.2:prove_single_hash";

type ArchivedProofStatus = "valid" | "merkle_invalid" | "proof_invalid" | "pending";

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function textToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function base64ToText(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
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
  const newTimeuuid = proof?.kayros?.timestamp?.response?.response?.timeuuid;
  if (typeof newTimeuuid === "string" && newTimeuuid.trim()) {
    return timeuuidToTimestamp(newTimeuuid);
  }

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
    metadataProofFileName: `${contentHash}_metadata_proof.json`,
    merkleProofFileName: `${contentHash}_merkle-proof.json`,
    merkleProofCandidateFileName: `${contentHash}_merkle-proof-candidate.json`,
    proofPath: `${dataTypeFolder}/${contentHash}_proof.json`,
    metadataProofPath: `${dataTypeFolder}/${contentHash}_metadata_proof.json`,
    merkleProofPath: `${dataTypeFolder}/${contentHash}_merkle-proof.json`,
    merkleProofCandidatePath: `${dataTypeFolder}/${contentHash}_merkle-proof-candidate.json`,
  };
}

async function getProofsRootFS() {
  try {
    const fs = await w3n.storage.getAppSyncedFS();
    await fs.makeFolder(PROOFS_ROOT_FOLDER).catch(() => {});
    return await fs.writableSubRoot(PROOFS_ROOT_FOLDER);
  } catch (err) {
    await w3n?.log?.("error", "Failed to open Kayros proofs root FS.", {
      root: PROOFS_ROOT_FOLDER,
      error: formatError(err),
    });
    throw err;
  }
}

async function getProofArchiveFolderFS(dataType: string) {
  const archivePaths = buildProofArchivePaths(dataType, "");
  try {
    const rootFs = await getProofsRootFS();
    await rootFs.makeFolder(archivePaths.dataTypeFolder).catch(() => {});
    return await rootFs.writableSubRoot(archivePaths.dataTypeFolder);
  } catch (err) {
    await w3n?.log?.("error", "Failed to open Kayros proof archive folder FS.", {
      dataType,
      folder: archivePaths.dataTypeFolder,
      error: formatError(err),
    });
    throw err;
  }
}

type ProofIndexEntry = {
  dataType: string;
  contentHash: string;
  title?: string;
  createdAt?: string;
  status?: ArchivedProofStatus;
  hasProof: boolean;
  hasMerkleProof: boolean;
  hasCandidateMerkleProof?: boolean;
  hasMeta: boolean;
};

function deriveArchivedProofStatus(entry: Partial<ProofIndexEntry>): ArchivedProofStatus {
  if (entry.status === "valid" || entry.status === "merkle_invalid" || entry.status === "proof_invalid" || entry.status === "pending") {
    return entry.status;
  }
  if (!entry.hasProof) {
    return "proof_invalid";
  }
  return "valid";
}

function normalizeProofIndexEntry(entry: unknown): ProofIndexEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const item = entry as Record<string, unknown>;
  const dataType = typeof item.dataType === "string" ? item.dataType.trim() : "";
  const contentHash = typeof item.contentHash === "string" ? item.contentHash.trim() : "";
  if (!dataType || !contentHash) {
    return null;
  }

  return {
    dataType,
    contentHash,
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : undefined,
    createdAt: typeof item.createdAt === "string" && item.createdAt.trim() ? item.createdAt : undefined,
    status: deriveArchivedProofStatus(item as Partial<ProofIndexEntry>),
    hasProof: item.hasProof !== false,
    hasMerkleProof: item.hasMerkleProof === true,
    hasCandidateMerkleProof: item.hasCandidateMerkleProof === true,
    hasMeta: item.hasMeta !== false,
  };
}

async function readProofIndex(): Promise<ProofIndexEntry[]> {
  try {
    const proofsFs = await getProofsRootFS();
    const raw = await proofsFs.readJSONFile(PROOFS_INDEX_FILE);
    return Array.isArray(raw)
      ? raw.map(normalizeProofIndexEntry).filter((entry): entry is ProofIndexEntry => entry !== null)
      : [];
  } catch (err) {
    await w3n?.log?.("info", "Kayros proof index read fallback.", {
      file: PROOFS_INDEX_FILE,
      error: formatError(err),
    });
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

async function updateProofIndexState(
  dataType: string,
  contentHash: string,
  patch: Partial<ProofIndexEntry>,
): Promise<ProofIndexEntry> {
  const entries = await readProofIndex();
  const existing = entries.find(entry => (
    entry.dataType === dataType
    && entry.contentHash === contentHash
  ));
  const nextEntry = normalizeProofIndexEntry({
    ...(existing ?? {
      dataType,
      contentHash,
      title: undefined,
      hasProof: true,
      hasMerkleProof: false,
      hasCandidateMerkleProof: false,
      hasMeta: true,
    }),
    ...patch,
    dataType,
    contentHash,
  });

  if (!nextEntry) {
    throw new Error("Failed to update proof index state.");
  }

  await writeProofIndex(upsertProofIndexEntry(entries, nextEntry));
  return nextEntry;
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
      await proofsFs.deleteFile(archivePaths.metadataProofPath).catch(() => {});
    }
    if (entry.hasMerkleProof) {
      await proofsFs.deleteFile(archivePaths.merkleProofPath).catch(() => {});
    }
    if (entry.hasCandidateMerkleProof) {
      await proofsFs.deleteFile(archivePaths.merkleProofCandidatePath).catch(() => {});
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
  metadataProof: any | undefined,
  meta: any,
  title: string | undefined,
  merkleProof: any | undefined,
  statusOverride?: ArchivedProofStatus,
) {
  const archivePaths = buildProofArchivePaths(dataType, contentHash);
  const folderFs = await getProofArchiveFolderFS(dataType);

  try {
    await folderFs.writeJSONFile(archivePaths.proofFileName, proof);
  } catch (err) {
    await w3n?.log?.("error", "Failed writing archived Kayros proof file.", {
      dataType,
      contentHash,
      path: archivePaths.proofFileName,
      error: formatError(err),
    });
    throw err;
  }
  if (metadataProof !== undefined) {
    try {
      await folderFs.writeJSONFile(archivePaths.metadataProofFileName, metadataProof);
    } catch (err) {
      await w3n?.log?.("error", "Failed writing archived Kayros metadata proof file.", {
        dataType,
        contentHash,
        path: archivePaths.metadataProofFileName,
        error: formatError(err),
      });
      throw err;
    }
  }

  if (merkleProof !== undefined) {
    try {
      await folderFs.writeJSONFile(archivePaths.merkleProofFileName, merkleProof);
    } catch (err) {
      await w3n?.log?.("error", "Failed writing archived Kayros merkle proof file.", {
        dataType,
        contentHash,
        path: archivePaths.merkleProofFileName,
        error: formatError(err),
      });
      throw err;
    }
  }

  const indexEntries = await readProofIndex();
  try {
    await writeProofIndex(upsertProofIndexEntry(indexEntries, {
      dataType,
      contentHash,
      title: typeof title === "string" && title.trim() ? title.trim() : undefined,
      createdAt: meta?.createdAt,
      status: statusOverride ?? (merkleProof !== undefined ? "valid" : "valid"),
      hasProof: true,
      hasMerkleProof: merkleProof !== undefined,
      hasCandidateMerkleProof: false,
      hasMeta: metadataProof !== undefined,
    }));
  } catch (err) {
    await w3n?.log?.("error", "Failed writing Kayros proof index.", {
      dataType,
      contentHash,
      error: formatError(err),
      title: typeof title === "string" ? title : undefined,
    });
    throw err;
  }
}

async function storeArchivedMerkleProof(
  dataType: string,
  contentHash: string,
  merkleProof: any,
  statusOverride?: ArchivedProofStatus,
) {
  const archivePaths = buildProofArchivePaths(dataType, contentHash);
  const folderFs = await getProofArchiveFolderFS(dataType);
  await folderFs.writeJSONFile(archivePaths.merkleProofFileName, merkleProof);
  await folderFs.deleteFile(archivePaths.merkleProofCandidateFileName).catch(() => {});

  const indexEntries = await readProofIndex();
  await writeProofIndex(upsertProofIndexEntry(indexEntries, {
    dataType,
    contentHash,
    status: statusOverride ?? "valid",
    hasProof: true,
    hasMerkleProof: true,
    hasCandidateMerkleProof: false,
    hasMeta: true,
  }));
}

async function storeArchivedCandidateMerkleProof(
  dataType: string,
  contentHash: string,
  merkleProof: any,
) {
  const archivePaths = buildProofArchivePaths(dataType, contentHash);
  const folderFs = await getProofArchiveFolderFS(dataType);
  await folderFs.writeJSONFile(archivePaths.merkleProofCandidateFileName, merkleProof);

  const indexEntries = await readProofIndex();
  await writeProofIndex(upsertProofIndexEntry(indexEntries, {
    dataType,
    contentHash,
    status: "merkle_invalid",
    hasProof: true,
    hasMerkleProof: true,
    hasCandidateMerkleProof: true,
    hasMeta: true,
  }));
}

async function loadArchivedProofBundle(dataType: string, contentHash: string) {
  const rootFs = await getProofsRootFS();
  const archivePaths = buildProofArchivePaths(dataType, contentHash);

  const [proof, metadataProof, merkleProof] = await Promise.all([
    readJSONIfPresent(rootFs, archivePaths.proofPath),
    readJSONIfPresent(rootFs, archivePaths.metadataProofPath),
    readJSONIfPresent(rootFs, archivePaths.merkleProofPath),
  ]);

  return {
    dataType,
    contentHash,
    proof,
    metadataProof,
    merkleProof,
    meta: undefined,
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

async function getRecordByHashWithRetry(
  host: string,
  recordHash: string,
  dataType: string,
  userKey?: string,
) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= KAYROS_RECORD_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt === 1) {
      await sleep(KAYROS_RECORD_FETCH_INITIAL_DELAY_MS);
    }
    try {
      return await getRecordByHash(host, recordHash, dataType, userKey);
    } catch (err) {
      lastErr = err;
      if (attempt >= KAYROS_RECORD_FETCH_ATTEMPTS) {
        break;
      }
      logInfo("Retrying Kayros record fetch after failure", {
        attempt,
        nextAttempt: attempt + 1,
        delayMs: KAYROS_RECORD_FETCH_RETRY_DELAY_MS,
        dataType,
        recordHash,
        error: formatError(err),
      });
      await sleep(KAYROS_RECORD_FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
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

function buildArchivedProofPayload(
  data: unknown,
  dataFormat: "PrivacySafe_file" | "PrivacySafe_file_metadata" | "raw_data" | "raw_hash",
  dataHash: string,
  registrationResponse: any,
  recordResponse: any,
) {
  return KayrosEnvelope.fromData(data, {
    hash: dataHash,
    hashAlgorithm: SHA256_ALGORITHM,
    timestamp: {
      service: PROVABLE_SDK_SERVICE,
      response: {
        success: true,
        response: registrationResponse,
        data: recordResponse,
      },
    },
  }, dataFormat).toJSON();
}

function getStoredProofRequestParts(proof: any, hostFallback: string, dataTypeFallback: string) {
  const envelope = KayrosEnvelope.fromJSON(JSON.stringify(proof));
  const kayrosHash = envelope.getKayrosHash();
  const dataItem = envelope.getDataHash();
  const dataType = envelope.getDataType() || dataTypeFallback;
  if (!kayrosHash || !dataItem || !dataType) {
    throw new Error("Stored proof is missing Kayros registration data.");
  }

  return {
    kayrosHost: hostFallback,
    dataType,
    dataItem,
    kayrosHash,
  };
}

function getStoredProofMeta(proof: any) {
  const envelope = KayrosEnvelope.fromJSON(JSON.stringify(proof));
  if (envelope.getDataFormat() !== "PrivacySafe_file") {
    return undefined;
  }

  try {
    const decoded = envelope.parseData<any>();
    return {
      createdAt: resolveProofCreatedAt(proof) || decoded?.uploadedAt,
      currentFilePath: typeof decoded?.currentFilePath === "string" ? decoded.currentFilePath : "",
      fsId: typeof decoded?.fsId === "string" ? decoded.fsId : null,
      originalFilename: typeof decoded?.originalFilename === "string" ? decoded.originalFilename : "",
    };
  } catch {
    return undefined;
  }
}

async function verifyEnvelopePayloadHash(proof: any): Promise<{
  ok: boolean;
  skipped: boolean;
  expectedHash?: string;
  computedHash?: string;
  detail: string;
}> {
  const envelope = KayrosEnvelope.fromJSON(JSON.stringify(proof));
  const dataFormat = envelope.getDataFormat();
  const expectedHash = envelope.getDataHash();

  if (!expectedHash) {
    return {
      ok: false,
      skipped: false,
      detail: "Stored proof is missing envelope data hash.",
    };
  }

  if (dataFormat === "raw_hash") {
    return {
      ok: true,
      skipped: true,
      expectedHash,
      computedHash: expectedHash,
      detail: `Raw hash proof: using stored hash ${expectedHash}.`,
    };
  }

  if (dataFormat === "PrivacySafe_file") {
    return {
      ok: true,
      skipped: true,
      expectedHash,
      detail: "PrivacySafe_file proof: local file-content hash reconstruction is not available from the stored payload.",
    };
  }

  const computedHash = await envelope.computeDataHash();
  return {
    ok: computedHash === expectedHash,
    skipped: false,
    expectedHash,
    computedHash,
    detail: computedHash === expectedHash
      ? `Reconstructed hash matches stored envelope hash ${expectedHash}.`
      : `Reconstructed hash mismatch: expected ${expectedHash}, computed ${computedHash}.`,
  };
}

function getPrimaryMismatchMessage(result: any, prefix: string): string {
  return `${prefix} (${result?.mismatches?.[0]?.message ?? "unknown mismatch"})`;
}

function joinMessages(...messages: Array<string | null | undefined>): string | null {
  const parts = messages
    .map(message => (typeof message === "string" ? message.trim() : ""))
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return Array.from(new Set(parts)).join(" | ");
}

function prefixDetails(prefix: string, details?: string[]): string[] {
  if (!Array.isArray(details) || details.length === 0) {
    return [];
  }
  return details.map(detail => `${prefix}: ${detail}`);
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
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);

    for (let attempt = 1; attempt <= KAYROS_REGISTER_RETRIES; attempt += 1) {
      try {
        const result = await this.registerHashOnce(request);
        const successful = ensureKayrosRegistrationSucceeded(result);
        if (request.skipArchive !== true) {
          try {
            await this.archiveManualRegistration(successful, resolved, request);
          } catch (archiveErr) {
            const detail = {
              dataType: resolved.dataType,
              contentHash: successful.request?.hash ?? "",
              error: formatError(archiveErr),
            };
            console.warn("Failed to store archived proof for manual registration.", detail);
            await w3n?.log?.("error", "Failed to store archived proof for manual registration.", detail);
          }
        }
        return successful;
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

  private async fetchMerkleProofsForProof(
    proof: any,
    kayrosHost: string,
    dataType: string,
    userKey?: string,
  ) {
    const requestParts = getStoredProofRequestParts(
      proof,
      kayrosHost,
      dataType,
    );

    return await getMerkleProof(
      requestParts.kayrosHost,
      requestParts.dataType,
      requestParts.kayrosHash,
      userKey,
    ).then(ensureMerkleProofSucceeded);
  }

  private scheduleMerkleProofPersistence(
    proof: any,
    contentHash: string,
    kayrosHost: string,
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
            const merkleProof = await this.fetchMerkleProofsForProof(proof, kayrosHost, dataType, userKey);
            const evaluation = await this.evaluateMerkleProofBundle(merkleProof);
            await storeArchivedMerkleProof(dataType, contentHash, merkleProof, evaluation.status);
            completed = true;
            logInfo("Stored Kayros delayed Merkle proof bundle", {
              attempt,
              dataType,
              contentHash,
              fullFilePath,
              status: evaluation.status,
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

  private async verifyStoredProofBundle(
    bundle: any,
    kayrosHost: string,
    dataType: string,
    userKey?: string,
  ): Promise<{ status: ArchivedProofStatus; note: string | null; details: string[] }> {
    const proof = bundle?.proof;
    if (!proof) {
      return { status: "proof_invalid", note: "Missing archived proof file.", details: [] };
    }

    const contentHashCheck = await verifyEnvelopePayloadHash(proof);
    if (!contentHashCheck.ok) {
      return {
        status: "proof_invalid",
        note: contentHashCheck.detail,
        details: [],
      };
    }
    const localHashDetails = [`Content payload: ${contentHashCheck.detail}`];

    const content = getStoredProofRequestParts(proof, kayrosHost, dataType);
    const apiKey = userKey?.trim() || undefined;

    setKayrosHost(content.kayrosHost);
    const contentVerification = await verifyWithInclusion({
      dataType: content.dataType,
      dataItem: content.dataItem,
      kayrosHash: content.kayrosHash,
      apiKey,
    });
    if (!contentVerification.valid) {
      return {
        status: "proof_invalid",
        note: contentVerification.error ?? "Content proof verification failed.",
        details: [],
      };
    }

    if (bundle?.metadataProof) {
      const metadata = getStoredProofRequestParts(bundle.metadataProof, kayrosHost, dataType);
      setKayrosHost(metadata.kayrosHost);
      const metadataVerification = await verifyWithInclusion({
        dataType: metadata.dataType,
        dataItem: metadata.dataItem,
        kayrosHash: metadata.kayrosHash,
        apiKey,
      });
      const metadataHashCheck = await verifyEnvelopePayloadHash(bundle.metadataProof);
      if (!metadataHashCheck.ok) {
        return {
          status: "proof_invalid",
          note: metadataHashCheck.detail,
          details: localHashDetails,
        };
      }
      localHashDetails.push(`Metadata payload: ${metadataHashCheck.detail}`);
      if (!metadataVerification.valid) {
        return {
          status: "proof_invalid",
          note: metadataVerification.error ?? "Metadata proof verification failed.",
          details: localHashDetails,
        };
      }
    }

    const storedMerkleProof = bundle?.merkleProof;
    if (!storedMerkleProof) {
      return {
        status: "valid",
        note: "Proof file is valid. No Merkle proof saved.",
        details: localHashDetails,
      };
    }

    const merkleVerification = await verifyMerkleProof({
      proof: storedMerkleProof as never,
    });
    if (merkleVerification.status === "invalid") {
      return {
        status: "merkle_invalid",
        note: `Stored Merkle proof is invalid: ${merkleVerification.error ?? merkleVerification.message ?? "unknown error"}`,
        details: [...localHashDetails, ...(merkleVerification.details ?? [])],
      };
    }

    return {
      status: merkleVerification.status === "pending" ? "pending" : "valid",
      note: merkleVerification.message ?? null,
      details: [...localHashDetails, ...(merkleVerification.details ?? [])],
    };
  }

  private async evaluateMerkleProofBundle(
    merkleProof: unknown,
  ): Promise<{ status: Exclude<ArchivedProofStatus, "proof_invalid">; note: string | null }> {
    const result = await verifyMerkleProof({ proof: merkleProof as never });
    if (result.status === "invalid") {
      return {
        status: "merkle_invalid",
        note: `Stored Merkle proof is invalid: ${result.error ?? result.message ?? "unknown error"}`,
      };
    }
    return {
      status: result.status === "pending" ? "pending" : "valid",
      note: result.message ?? null,
    };
  }

  async updateArchivedProof(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    if (!contentHash) {
      throw new Error("Missing contentHash for updateArchivedProof.");
    }

    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    if (!bundle?.proof) {
      const status = "proof_invalid" as const;
      await updateProofIndexState(resolved.dataType, contentHash, { status, hasProof: false });
      return {
        dataType: resolved.dataType,
        contentHash,
        status,
        note: "Missing archived proof file.",
        details: [],
        replacedMerkleProof: false,
        storedCandidateMerkleProof: false,
      };
    }

    const currentStatus = deriveArchivedProofStatus({
      hasProof: true,
      hasMerkleProof: bundle.merkleProof !== undefined,
    });

    try {
      const latestMerkleProof = await this.fetchMerkleProofsForProof(
        bundle.proof,
        resolved.kayrosHost,
        resolved.dataType,
        resolved.userKey,
      );
      const evaluation = await this.evaluateMerkleProofBundle(latestMerkleProof);
      const storedMerkleProof = bundle.merkleProof;
      if (!storedMerkleProof) {
        await storeArchivedMerkleProof(resolved.dataType, contentHash, latestMerkleProof, evaluation.status);
        return {
          dataType: resolved.dataType,
          contentHash,
          status: evaluation.status,
          note: evaluation.note,
          details: [],
          replacedMerkleProof: true,
          storedCandidateMerkleProof: false,
        };
      }

      const compatibility = checkMerkleProofCompatibility(
        storedMerkleProof as never,
        latestMerkleProof as never,
      );
      if (!compatibility.compatible) {
        await storeArchivedCandidateMerkleProof(resolved.dataType, contentHash, latestMerkleProof);
        return {
          dataType: resolved.dataType,
          contentHash,
          status: "merkle_invalid" as const,
          note: getPrimaryMismatchMessage(compatibility, "proof incompatible"),
          details: [],
          replacedMerkleProof: false,
          storedCandidateMerkleProof: true,
        };
      }

      if (evaluation.status === "merkle_invalid") {
        await storeArchivedCandidateMerkleProof(resolved.dataType, contentHash, latestMerkleProof);
        return {
          dataType: resolved.dataType,
          contentHash,
          status: "merkle_invalid" as const,
          note: evaluation.note,
          details: [],
          replacedMerkleProof: false,
          storedCandidateMerkleProof: true,
        };
      }

      await storeArchivedMerkleProof(resolved.dataType, contentHash, latestMerkleProof, evaluation.status);
      return {
        dataType: resolved.dataType,
        contentHash,
        status: evaluation.status,
        note: evaluation.note,
        details: [],
        replacedMerkleProof: true,
        storedCandidateMerkleProof: false,
      };
    } catch (err) {
      return {
        dataType: resolved.dataType,
        contentHash,
        status: currentStatus,
        note: formatError(err),
        details: [],
        replacedMerkleProof: false,
        storedCandidateMerkleProof: false,
      };
    }
  }

  async verifyArchivedProof(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    if (!contentHash) {
      throw new Error("Missing contentHash for verifyArchivedProof.");
    }

    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    const fallbackStatus = deriveArchivedProofStatus({
      hasProof: bundle?.proof !== undefined,
      hasMerkleProof: bundle?.merkleProof !== undefined,
    });

    try {
      const result = await this.verifyStoredProofBundle(bundle, resolved.kayrosHost, resolved.dataType, resolved.userKey);
      await updateProofIndexState(resolved.dataType, contentHash, { status: result.status });
      logInfo("Verified Kayros archived proof", {
        dataType: resolved.dataType,
        contentHash,
        status: result.status,
        note: result.note,
      });
      return {
        dataType: resolved.dataType,
        contentHash,
        status: result.status,
        note: result.note,
        details: result.details,
        replacedMerkleProof: false,
        storedCandidateMerkleProof: false,
      };
    } catch (err) {
      const message = formatError(err);
      await w3n?.log?.("error", "Kayros archived proof verification failed", {
        dataType: resolved.dataType,
        contentHash,
        error: message,
      });
      return {
        dataType: resolved.dataType,
        contentHash,
        status: fallbackStatus,
        note: message,
        details: [],
        replacedMerkleProof: false,
        storedCandidateMerkleProof: false,
      };
    }
  }

  async getProofFile(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    return bundle.proof;
  }

  async getMetadataProofFile(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    const bundle = await loadArchivedProofBundle(resolved.dataType, contentHash);
    return bundle.metadataProof;
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
    return bundle.meta ?? getStoredProofMeta(bundle.proof);
  }

  async removeMerkleProofFile(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    if (!contentHash) {
      throw new Error("Missing contentHash for removeMerkleProofFile.");
    }

    const proofsFs = await getProofsRootFS();
    const archivePaths = buildProofArchivePaths(resolved.dataType, contentHash);

    await Promise.all([
      proofsFs.deleteFile(archivePaths.merkleProofPath).catch(() => {}),
      proofsFs.deleteFile(archivePaths.merkleProofCandidatePath).catch(() => {}),
    ]);

    await updateProofIndexState(resolved.dataType, contentHash, {
      status: "valid",
      hasMerkleProof: false,
      hasCandidateMerkleProof: false,
    });

    return {
      dataType: resolved.dataType,
      contentHash,
      removed: true,
    };
  }

  async removeArchivedProof(request: Record<string, unknown>) {
    const stored = await readSettings();
    const resolved = mergeSettings(stored, request);
    const contentHash = String(request.contentHash ?? "").trim();
    if (!contentHash) {
      throw new Error("Missing contentHash for removeArchivedProof.");
    }

    const proofsFs = await getProofsRootFS();
    const archivePaths = buildProofArchivePaths(resolved.dataType, contentHash);

    await Promise.all([
      proofsFs.deleteFile(archivePaths.proofPath).catch(() => {}),
      proofsFs.deleteFile(archivePaths.metadataProofPath).catch(() => {}),
      proofsFs.deleteFile(archivePaths.merkleProofPath).catch(() => {}),
      proofsFs.deleteFile(archivePaths.merkleProofCandidatePath).catch(() => {}),
    ]);

    const entries = await readProofIndex();
    await writeProofIndex(removeProofIndexEntry(entries, resolved.dataType, contentHash));

    return {
      dataType: resolved.dataType,
      contentHash,
      removed: true,
    };
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
      }).map(entry => ({
        ...entry,
        status: deriveArchivedProofStatus(entry),
      })),
    };

    logInfo("Listed Kayros archived proofs", {
      requestedDataType: response.dataType || null,
      count: response.entries.length,
    });

    return response;
  }

  private async archiveManualRegistration(
    result: any,
    resolved: ReturnType<typeof normalizeSettings>,
    request: Record<string, unknown>,
  ) {
    const contentHash = typeof result?.request?.hash === "string" ? result.request.hash.trim() : "";
    if (!contentHash) {
      return;
    }

    const archivedAt = new Date().toISOString();
    const hasRawContent = typeof request.archiveRawContent === "string";
    const archivedPayload = hasRawContent
      ? request.archiveRawContent
      : contentHash;
      const archivedDataFormat = hasRawContent ? "raw_data" : "raw_hash";
      const archiveTitle = typeof request.archiveTitle === "string" && request.archiveTitle.trim()
        ? request.archiveTitle.trim()
        : (typeof request.archiveLabel === "string" && request.archiveLabel.trim()
        ? request.archiveLabel.trim()
        : (hasRawContent ? "Raw data" : "Raw hash"));
    const record = await getRecordByHash(
      resolved.kayrosHost,
      result.response.hash,
      resolved.dataType,
      resolved.userKey,
    );
    const proof = buildArchivedProofPayload(
      archivedPayload,
      archivedDataFormat,
      contentHash,
      result.response,
      record,
    );
    const meta = {
      createdAt: archivedAt,
      currentFilePath: "",
      fsId: null,
      originalFilename: archiveTitle,
    };
    const status: ArchivedProofStatus = "valid";

    await storeArchivedProofBundle(
      resolved.dataType,
      contentHash,
      proof,
      undefined,
      meta,
      archiveTitle,
      undefined,
      status,
    );

    if (resolved.saveMerkleProofs) {
      this.scheduleMerkleProofPersistence(
        proof,
        contentHash,
        resolved.kayrosHost,
        resolved.dataType,
        "Raw data",
        resolved.userKey,
      );
    }
  }

  async notarizeStoredFile(request: any, file: any) {
    const stored = await readSettings();
    logInfo("Starting Kayros notarizeStoredFile", {
      fullFilePath: request?.fullFilePath,
      fsId: request?.fsId,
      originalName: request?.metadataPayload?.originalName,
      size: request?.metadataPayload?.size,
    });
    const fileBytes = await file.readBytes();
    if (!fileBytes) {
      throw new Error("Stored file is empty or unreadable.");
    }

    const [contentHash, metadataHash] = await Promise.all([
      createSha256Hex(fileBytes),
      createSha256Hex(new TextEncoder().encode(JSON.stringify(request.metadataPayload))),
    ]);

    const [contentResult, metadataResult] = await Promise.allSettled([
      this.registerHash({ hash: contentHash, skipArchive: true }),
      this.registerHash({ hash: metadataHash, skipArchive: true }),
    ]);
    logInfo("Completed Kayros registerHash calls for stored file", {
      fullFilePath: request?.fullFilePath,
      contentStatus: contentResult.status,
      metadataStatus: metadataResult.status,
      contentHash,
      metadataHash,
    });

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
    let archivedProof: any;
    try {
      const archivedData = {
        version: 1,
        storageFileId: request.metadataPayload.storageFileId,
        originalName: request.metadataPayload.originalName,
        mimeType: request.metadataPayload.mimeType,
        size: request.metadataPayload.size,
        lastModified: request.metadataPayload.lastModified,
        uploadedAt: request.metadataPayload.uploadedAt,
        currentFilePath: request.fullFilePath,
        fsId: typeof request.fsId === "string" ? request.fsId : null,
        originalFilename: request.metadataPayload.originalName,
      };
      archivedProof = buildArchivedProofPayload(
        archivedData,
        "PrivacySafe_file",
        proof.content.hash,
        contentResult.status === "fulfilled" ? contentResult.value.response : proof.content.response,
        await getRecordByHashWithRetry(
          stored.kayrosHost,
          contentResult.status === "fulfilled" ? contentResult.value.response.hash : proof.content.response.hash,
          archivedDataType,
          stored.userKey,
        ),
      );
      const archivedMetadataProof = buildArchivedProofPayload(
        request.metadataPayload,
        "PrivacySafe_file_metadata",
        proof.metadata.hash,
        metadataResult.status === "fulfilled" ? metadataResult.value.response : proof.metadata.response,
        await getRecordByHashWithRetry(
          stored.kayrosHost,
          metadataResult.status === "fulfilled" ? metadataResult.value.response.hash : proof.metadata.response.hash,
          archivedDataType,
          stored.userKey,
        ),
      );
      await storeArchivedProofBundle(
        archivedDataType,
        proof.content.hash,
        archivedProof,
        archivedMetadataProof,
        {
          createdAt: archivedAt,
          currentFilePath: request.fullFilePath,
          fsId: typeof request.fsId === "string" ? request.fsId : null,
          originalFilename: request.metadataPayload.originalName,
        },
        request.metadataPayload.originalName,
        undefined,
        "valid",
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
        archivedProof,
        proof.content.hash,
        stored.kayrosHost,
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

    if (method === "getMetadataProofFile") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.getMetadataProofFile(decodeJsonObject(data))),
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

    if (method === "removeMerkleProofFile") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.removeMerkleProofFile(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "removeArchivedProof") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.removeArchivedProof(decodeJsonObject(data))),
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

    if (method === "updateArchivedProof") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.updateArchivedProof(decodeJsonObject(data))),
      });
      return;
    }

    if (method === "verifyArchivedProof") {
      await connection.send({
        callNum,
        callStatus: "end",
        data: encodeJson(await service.verifyArchivedProof(decodeJsonObject(data))),
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
