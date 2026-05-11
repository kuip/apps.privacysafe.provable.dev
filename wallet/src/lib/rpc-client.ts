import type { Chain } from '@/lib/types';

export type RpcErrorKind =
  | 'permission'
  | 'cors-or-fetch-blocked'
  | 'rate-limit'
  | 'provider-rejected'
  | 'timeout'
  | 'invalid-request'
  | 'insufficient-funds'
  | 'simulation-failed'
  | 'network-mismatch';

export interface RpcErrorContext {
  chain?: Chain;
  endpoint?: string;
  method?: string;
  label?: string;
  status?: number;
  code?: number;
  diagnostics?: string;
}

export class RpcClientError extends Error {
  readonly kind: RpcErrorKind;
  readonly userMessage: string;
  readonly context: RpcErrorContext;

  constructor(kind: RpcErrorKind, userMessage: string, context: RpcErrorContext = {}) {
    super(userMessage);
    this.name = this.constructor.name;
    this.kind = kind;
    this.userMessage = userMessage;
    this.context = context;
  }
}

export class RpcPermissionError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('permission', userMessage, context);
  }
}

export class RpcCorsOrFetchBlockedError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('cors-or-fetch-blocked', userMessage, context);
  }
}

export class RpcRateLimitError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('rate-limit', userMessage, context);
  }
}

export class RpcProviderRejectedError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('provider-rejected', userMessage, context);
  }
}

export class RpcTimeoutError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('timeout', userMessage, context);
  }
}

export class RpcInvalidRequestError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('invalid-request', userMessage, context);
  }
}

export class RpcInsufficientFundsError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('insufficient-funds', userMessage, context);
  }
}

export class RpcSimulationFailedError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('simulation-failed', userMessage, context);
  }
}

export class RpcNetworkMismatchError extends RpcClientError {
  constructor(userMessage: string, context?: RpcErrorContext) {
    super('network-mismatch', userMessage, context);
  }
}

type JsonRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export interface JsonRpcCallOptions {
  chain: Chain;
  endpoint: string;
  method: string;
  params: unknown[];
  label: string;
  timeoutMs: number;
}

export interface JsonRpcFallbackOptions extends Omit<JsonRpcCallOptions, 'endpoint'> {
  endpoints: string[];
  logError?: (message: string, err: unknown) => Promise<void>;
}

function chainName(chain: Chain): string {
  return chain === 'ethereum' ? 'Ethereum' : 'Solana';
}

function detailsFromUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === 'object' && value) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function providerMessage(message: string | undefined): string {
  return message?.trim() || 'Unknown RPC error';
}

function contextWithDiagnostics(
  options: JsonRpcCallOptions,
  diagnostics: string,
  extra: Partial<RpcErrorContext> = {},
): RpcErrorContext {
  return {
    chain: options.chain,
    endpoint: options.endpoint,
    method: options.method,
    label: options.label,
    diagnostics,
    ...extra,
  };
}

function errorFromHttpStatus(options: JsonRpcCallOptions, status: number, body: string): RpcClientError {
  const diagnostics = `HTTP ${status}${body ? `: ${body.slice(0, 500)}` : ''}`;
  const context = contextWithDiagnostics(options, diagnostics, { status });
  if (status === 401 || status === 403) {
    return new RpcPermissionError(
      `${chainName(options.chain)} RPC access was rejected while handling ${options.label}.`,
      context,
    );
  }
  if (status === 408 || status === 425 || status === 429) {
    return new RpcRateLimitError(
      `${chainName(options.chain)} RPC endpoint is rate-limited or temporarily unavailable while handling ${options.label}.`,
      context,
    );
  }
  if (status >= 500) {
    return new RpcProviderRejectedError(
      `${chainName(options.chain)} RPC provider is temporarily unavailable while handling ${options.label}.`,
      context,
    );
  }
  return new RpcProviderRejectedError(
    `${chainName(options.chain)} RPC provider rejected ${options.label}.`,
    context,
  );
}

function errorFromJsonRpc(options: JsonRpcCallOptions, code: number | undefined, message: string | undefined, data: unknown): RpcClientError {
  const text = providerMessage(message);
  const diagnostics = `JSON-RPC ${code ?? 'unknown'}: ${text}${data === undefined ? '' : ` ${detailsFromUnknown(data)}`}`;
  const context = contextWithDiagnostics(options, diagnostics, { code });
  if (/insufficient funds|insufficient lamports|exceeds balance/i.test(text)) {
    return new RpcInsufficientFundsError('Insufficient funds for this transaction.', context);
  }
  if (/simulation failed|preflight|custom program error|transaction simulation/i.test(text)) {
    return new RpcSimulationFailedError(`Transaction simulation failed: ${text}`, context);
  }
  if (code === -32600 || code === -32601 || code === -32602 || /invalid request|invalid params|method not found/i.test(text)) {
    return new RpcInvalidRequestError(`${chainName(options.chain)} RPC request was invalid for ${options.label}.`, context);
  }
  if (/chain id|wrong network|network mismatch/i.test(text)) {
    return new RpcNetworkMismatchError(`${chainName(options.chain)} network mismatch while handling ${options.label}.`, context);
  }
  return new RpcProviderRejectedError(`${chainName(options.chain)} RPC provider rejected ${options.label}: ${text}`, context);
}

function isRetryableRpcError(err: unknown): boolean {
  return err instanceof RpcCorsOrFetchBlockedError
    || err instanceof RpcTimeoutError
    || err instanceof RpcRateLimitError
    || err instanceof RpcPermissionError
    || (
      err instanceof RpcProviderRejectedError
      && (err.context.status === undefined || err.context.status >= 500)
    );
}

export async function jsonRpc<T>(options: JsonRpcCallOptions): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: options.method,
        params: options.params,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    const diagnostics = detailsFromUnknown(err);
    if (controller.signal.aborted) {
      throw new RpcTimeoutError(
        `${chainName(options.chain)} RPC request timed out while handling ${options.label}.`,
        contextWithDiagnostics(options, diagnostics),
      );
    }
    throw new RpcCorsOrFetchBlockedError(
      `${chainName(options.chain)} RPC request could not be sent while handling ${options.label}.`,
      contextWithDiagnostics(options, diagnostics),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw errorFromHttpStatus(options, response.status, body);
  }

  let payload: JsonRpcResponse<T>;
  try {
    payload = await response.json() as JsonRpcResponse<T>;
  } catch (err) {
    throw new RpcProviderRejectedError(
      `${chainName(options.chain)} RPC provider returned an invalid response for ${options.label}.`,
      contextWithDiagnostics(options, detailsFromUnknown(err)),
    );
  }

  if (payload.error) {
    throw errorFromJsonRpc(options, payload.error.code, payload.error.message, payload.error.data);
  }
  if (payload.result === undefined) {
    throw new RpcProviderRejectedError(
      `${chainName(options.chain)} RPC provider returned no result for ${options.label}.`,
      contextWithDiagnostics(options, 'JSON-RPC result is undefined'),
    );
  }
  return payload.result;
}

export async function jsonRpcWithFallback<T>(options: JsonRpcFallbackOptions): Promise<T> {
  let lastError: unknown;
  const attempts: string[] = [];

  for (const endpoint of options.endpoints) {
    try {
      return await jsonRpc<T>({ ...options, endpoint });
    } catch (err) {
      lastError = err;
      attempts.push(`${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
      if (!isRetryableRpcError(err)) {
        throw err;
      }
    }
  }

  const diagnostics = attempts.join(' | ');
  await options.logError?.(
    `Wallet could not reach ${options.chain} RPC endpoints for ${options.label}: ${diagnostics}`,
    lastError,
  );
  throw new RpcCorsOrFetchBlockedError(
    `Could not reach ${chainName(options.chain)} RPC endpoint for ${options.label}. Tried ${options.endpoints.length} endpoints.`,
    {
      chain: options.chain,
      method: options.method,
      label: options.label,
      diagnostics,
    },
  );
}

export function rpcUserMessage(err: unknown): string | undefined {
  return err instanceof RpcClientError ? err.userMessage : undefined;
}
