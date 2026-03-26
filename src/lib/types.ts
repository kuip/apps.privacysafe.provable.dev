import type {
  ProveOptions,
  GetRecordResponse,
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
