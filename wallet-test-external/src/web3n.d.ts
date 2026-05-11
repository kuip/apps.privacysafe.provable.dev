/// <reference types="vite/client" />

declare namespace web3n.rpc {
  interface PassedDatum {
    bytes?: Uint8Array;
  }

  interface Connection {
    makeRequestReplyCall(method: string, data?: PassedDatum): Promise<PassedDatum | undefined>;
    close(): Promise<void>;
  }
}

declare const w3n: {
  rpc?: {
    otherAppsRPC?(appDomain: string, serviceName: string): Promise<web3n.rpc.Connection>;
  };
  log?: (level: string, message: string, err?: unknown) => Promise<void> | void;
};
