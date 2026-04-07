import type {
  ProveOptions,
  GetRecordResponse,
  GetRecordByDataItemResponse,
  ProveSingleHashResponse,
} from '@kuip/provable-sdk';

export interface KayrosSettings {
  kayrosHost: string;
  dataType: string;
  userKey: string;
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

export interface NotarizeStoredFileRequest {
  fullFilePath: string;
  metadataPayload: UploadedFileMetadata;
}

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

export interface KayrosUploadProof {
  version: 1;
  status: KayrosUploadStatus;
  uploadedAt: string;
  metadataPayload: UploadedFileMetadata;
  content: KayrosNotaryEntry;
  metadata: KayrosNotaryEntry;
}

export type NotarizeStoredFileResult = {
  status: KayrosUploadStatus;
  proofWritten: boolean;
};

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
