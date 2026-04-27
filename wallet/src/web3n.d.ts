/// <reference types="vite/client" />

declare namespace web3n.rpc {
  interface PassedDatum {
    bytes?: Uint8Array;
  }

  interface Connection {
    makeRequestReplyCall(method: string, data?: PassedDatum): Promise<PassedDatum | undefined>;
    send(message: unknown): Promise<void>;
    watch(observer: {
      next(message: unknown): Promise<void> | void;
      complete?(): void;
      error?(err: unknown): Promise<void> | void;
    }): void;
    close(): Promise<void>;
  }

  type ExposeService = (
    serviceName: string,
    observer: {
      next(connection: Connection): void;
      complete?(): void;
      error?(err: unknown): Promise<void> | void;
    },
  ) => void;
}

declare const w3n: {
  storage?: {
    getAppLocalFS?(): Promise<web3n.files.WritableFS>;
    getAppSyncedFS?(): Promise<web3n.files.WritableFS>;
  };
  rpc?: {
    thisApp?(serviceName: string): Promise<web3n.rpc.Connection>;
    exposeService?: web3n.rpc.ExposeService;
  };
  shell?: {
    getFSResource?: (appDomain: string, resource: string) => Promise<web3n.files.ReadableFile | undefined>;
    openURL?: (url: string) => Promise<void>;
    clipboard?: {
      writeText?: (text: string) => Promise<void>;
    };
  };
  log?: (level: string, message: string, err?: unknown) => Promise<void> | void;
};

declare namespace web3n.files {
  interface WatchEvent {
    type: string;
  }

  interface ReadableFile {
    readJSON<T>(): Promise<T>;
    watch?(observer: {
      next(event: WatchEvent): Promise<void> | void;
      complete?(): void;
      error?(err: unknown): Promise<void> | void;
    }): (() => void) | void;
  }

  interface FileException extends Error {
    notFound?: true;
  }

  interface WritableFile {
    isNew?: boolean;
    writeJSON(json: unknown): Promise<number | void>;
    readJSON<T>(): Promise<T>;
  }

  interface WritableFS {
    writableFile(path: string): Promise<WritableFile>;
    readJSONFile<T>(path: string): Promise<T>;
    writeJSONFile(path: string, json: unknown): Promise<void>;
  }
}
