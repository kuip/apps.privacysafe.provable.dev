declare namespace web3n.keys {
  interface SignedLoad {
    alg: string;
    kid: string;
    sig: string;
    load: string;
  }
}

declare namespace web3n.mailerid {
  interface MailerIdSignature {
    rootMidCert: web3n.keys.SignedLoad;
    provCert: web3n.keys.SignedLoad;
    signeeCert: web3n.keys.SignedLoad;
    signature: web3n.keys.SignedLoad;
  }

  interface Service {
    getUserId(): Promise<string>;
    sign(payload: Uint8Array): Promise<MailerIdSignature>;
  }
}

declare const w3n: {
  mailerid?: web3n.mailerid.Service;
  myVersion?: () => Promise<string | undefined>;
  closeSelf?: () => Promise<void> | void;
  shell?: {
    openDashboard?: () => Promise<void>;
    openURL?: (url: string) => Promise<void>;
  };
  log?: (level: string, ...args: unknown[]) => void | Promise<void>;
};
