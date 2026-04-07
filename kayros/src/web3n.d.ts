declare namespace web3n.rpc {
  interface PassedDatum {
    bytes?: Uint8Array;
    passedByReference?: unknown[];
  }

  interface Observer<T> {
    next?: (value: T) => void | Promise<void>;
    error?: (err: unknown) => void | Promise<void>;
    complete?: () => void | Promise<void>;
  }

  interface RPC {
    thisApp?: client.AppRPC;
    exposeService?: service.ExposeService;
  }
}

declare namespace web3n.rpc.client {
  interface RPCConnection {
    close(): Promise<void>;
    makeRequestReplyCall(
      method: string,
      req: web3n.rpc.PassedDatum | undefined,
    ): Promise<web3n.rpc.PassedDatum | undefined>;
  }

  type AppRPC = (service: string) => Promise<RPCConnection>;
}

declare namespace web3n.rpc.service {
  type IncomingMsg = CallStart | CallCancel;

  type ExposeService = (
    service: string,
    obs: web3n.rpc.Observer<IncomingConnection>,
  ) => (() => void) | void;

  interface IncomingConnection {
    close(): Promise<void>;
    watch(obs: web3n.rpc.Observer<IncomingMsg>): (() => void) | void;
    send(msg: OutgoingMsg): Promise<void>;
  }

  interface CallStart {
    msgType: 'start';
    callNum: number;
    method: string;
    data?: web3n.rpc.PassedDatum;
  }

  interface CallCancel {
    msgType: 'cancel';
    callNum: number;
  }

  interface OutgoingMsg {
    callNum: number;
    callStatus: 'end' | 'interim' | 'error';
    data?: web3n.rpc.PassedDatum;
    err?: unknown;
  }
}

declare namespace web3n.storage {
  interface AppLocalFS {
    readJSONFile(path: string): Promise<unknown>;
    writeJSONFile(path: string, json: unknown): Promise<void>;
  }
}

declare namespace web3n.files {
  interface FileChangeEvent {
    type: 'file-change';
  }

  interface ReadonlyFile {
    name: string;
    readBytes(start?: number, end?: number): Promise<Uint8Array | undefined>;
    readJSON<T>(): Promise<T>;
    watch?(obs: web3n.rpc.Observer<FileChangeEvent>): (() => void) | void;
  }

  interface WritableFile extends ReadonlyFile {
    updateXAttrs(changes: {
      set?: Record<string, unknown>;
      remove?: string[];
    }): Promise<void>;
  }

  interface WritableFS {
    writeJSONFile(path: string, json: unknown): Promise<void>;
  }
}

declare const w3n: {
  rpc?: web3n.rpc.RPC;
  storage?: {
    getAppLocalFS(): Promise<web3n.storage.AppLocalFS>;
  };
  shell?: {
    getFSResource?(
      appDomain: string | undefined,
      resourceName: string,
    ): Promise<web3n.files.ReadonlyFile | undefined>;
  };
  log?: (level: string, ...args: unknown[]) => void | Promise<void>;
};
