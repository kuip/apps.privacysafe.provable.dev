export const WALLET_SERVICE_NAME = 'WalletSigner';
export const WALLET_INTERNAL_SERVICE_NAME = 'WalletInternal';
export const WALLET_VAULT_PATH = 'wallet-vault-v1.json';
export const WALLET_STATE_PATH = 'wallet-state-v1.json';

export const DEFAULT_NETWORKS = {
  ethereum: {
    key: 'ethereum:mainnet',
    chain: 'ethereum',
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.llamarpc.com',
      'https://ethereum.drpc.org',
      'https://rpc.flashbots.net',
    ],
    chainId: 1,
  },
  solana: {
    key: 'solana:mainnet',
    chain: 'solana',
    name: 'Solana',
    nativeSymbol: 'SOL',
    rpcUrl: 'https://solana-rpc.publicnode.com',
    rpcUrls: [
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com',
    ],
  },
} as const;

export const DEFAULT_TOKENS = [
  {
    id: 'ethereum:mainnet:weth',
    chain: 'ethereum',
    networkKey: 'ethereum:mainnet',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
  },
  {
    id: 'solana:mainnet:cia',
    chain: 'solana',
    networkKey: 'solana:mainnet',
    symbol: 'CIA',
    name: 'Creator Intelligence Agency',
    address: '6Zip2rHpQaqpqKmZUzfCUDX2tGyx1GQVpZgWHuQFNCiA',
    decimals: 6,
  },
] as const;
