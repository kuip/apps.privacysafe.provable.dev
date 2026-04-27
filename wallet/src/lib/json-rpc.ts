export function encodeJson(value: unknown): web3n.rpc.PassedDatum {
  const text = JSON.stringify(value ?? null);
  return { bytes: new TextEncoder().encode(text) };
}

export function decodeJson<T>(datum: web3n.rpc.PassedDatum | undefined): T {
  if (!datum?.bytes) {
    return undefined as T;
  }
  const text = new TextDecoder().decode(datum.bytes);
  return JSON.parse(text) as T;
}

export async function callThisAppService<TRequest, TResponse>(
  service: string,
  method: string,
  payload: TRequest,
): Promise<TResponse> {
  const connection = await w3n.rpc!.thisApp!(service);
  try {
    const reply = await connection.makeRequestReplyCall(method, encodeJson(payload));
    return decodeJson<TResponse>(reply);
  } finally {
    await connection.close();
  }
}
