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

export type RegisterHashResult = {
  request: RegisterHashRequest;
  response: ProveSingleHashResponse;
  recordUrl?: string;
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
