import type {
  GetRecordResponse,
  ProveSingleHashResponse,
} from '@kuip/provable-sdk';

export interface KayrosSettings {
  kayrosHost: string;
  dataType: string;
  userKey: string;
}

export interface ServiceRequestBase {
  kayrosHost?: string;
  dataType?: string;
  userKey?: string;
}

export interface RegisterHashRequest extends ServiceRequestBase {
  hash: string;
}

export interface LookupRecordRequest extends ServiceRequestBase {
  hash: string;
}

export interface RegisterHashResult {
  request: RegisterHashRequest;
  response: ProveSingleHashResponse;
  recordUrl?: string;
}

export interface LookupRecordResult {
  request: LookupRecordRequest;
  response: GetRecordResponse;
  recordUrl: string;
}
