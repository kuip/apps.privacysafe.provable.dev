import type {
  ProveOptions,
  GetRecordResponse,
  GetRecordByDataItemResponse,
  ProveSingleHashResponse,
} from '@kuip/provable-sdk';
import type { KayrosProof, ProofDataFormat } from '@kuip/provable-proof';

export interface KayrosSettings {
  kayrosHost: string;
  dataType: string;
  userKey: string;
  saveMerkleProofs: boolean;
}

export type ServiceRequestBase = Pick<ProveOptions, 'dataType' | 'userKey'> & {
  kayrosHost?: string;
};

export interface RegisterHashRequest extends ServiceRequestBase {
  hash: string;
}

export interface LookupRecordRequest extends ServiceRequestBase {
  hash: string;
}

export interface LookupDataItemRequest extends ServiceRequestBase {
  dataItem: string;
  limit?: number;
}

export interface UploadedFileMetadata {
  storageFileId: string;
  originalName: string;
  mimeType: string;
  size: number;
  lastModified: number;
  uploadedAt: string;
}

export interface PrivacySafeFileProofData extends UploadedFileMetadata {
  version: 1;
  currentFilePath: string;
  fsId?: string | null;
  originalFilename: string;
}

export type RawDataProofData = string;

export interface NotarizeStoredFileRequest {
  fullFilePath: string;
  metadataPayload: UploadedFileMetadata;
  fsId?: string | null;
}

export type ArchivedProofDataFormat = 'PrivacySafe_file' | 'PrivacySafe_file_metadata' | 'raw_data' | 'raw_hash';

export type RegisterHashResult = {
  request: RegisterHashRequest;
  response: ProveSingleHashResponse;
  recordUrl?: string;
};

export type KayrosNotaryStatus = 'registered' | 'failed';
export type KayrosUploadStatus = 'registered' | 'partial' | 'failed';

export interface KayrosNotaryEntry {
  label: 'content' | 'metadata';
  status: KayrosNotaryStatus;
  algorithm: 'SHA-256';
  hash: string;
  request?: {
    hash: string;
    kayrosHost?: string;
    dataType?: string;
  };
  response?: {
    success: boolean;
    hash?: string;
    timeuuid?: string;
    encoding?: string;
    error?: string;
  };
  recordUrl?: string;
  error?: string;
}

export type NotarizeStoredFileResult = {
  status: KayrosUploadStatus;
  proofWritten: boolean;
};

export interface KayrosProofMeta {
  createdAt?: string;
  currentFilePath: string;
  fsId?: string | null;
  originalFilename: string;
}

export type ArchivedProofStatus = 'valid' | 'merkle_invalid' | 'proof_invalid' | 'pending';

export interface ArchivedProofFileRequest extends ServiceRequestBase {
  dataType: string;
  contentHash: string;
}

export interface ArchivedProofBundle {
  dataType: string;
  contentHash: string;
  proof?: KayrosProof;
  metadataProof?: KayrosProof;
  merkleProof?: unknown;
  meta?: KayrosProofMeta;
}

export interface SaveMerkleProofFileRequest extends ArchivedProofFileRequest {
  merkleProof: unknown;
}

export interface SaveMerkleProofFileResult {
  dataType: string;
  contentHash: string;
  saved: true;
}

export interface ArchivedProofActionResult {
  dataType: string;
  contentHash: string;
  status: ArchivedProofStatus;
  note: string | null;
  details?: string[];
  replacedMerkleProof: boolean;
  storedCandidateMerkleProof: boolean;
}

export interface ArchivedProofListEntry {
  dataType: string;
  contentHash: string;
  title?: string;
  createdAt?: string;
  status: ArchivedProofStatus;
  hasProof: boolean;
  hasMerkleProof: boolean;
  hasMeta: boolean;
  meta?: KayrosProofMeta;
}

export interface ListArchivedProofsRequest extends ServiceRequestBase {
  dataType?: string;
}

export interface ListArchivedProofsResult {
  dataType: string;
  entries: ArchivedProofListEntry[];
}

export type LookupRecordResult = {
  request: LookupRecordRequest;
  response: GetRecordResponse;
  recordUrl: string;
};

export type LookupDataItemResult = {
  request: LookupDataItemRequest;
  response: GetRecordByDataItemResponse;
  recordUrls: string[];
};
