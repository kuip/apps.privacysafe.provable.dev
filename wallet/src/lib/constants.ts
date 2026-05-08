export const WALLET_SERVICE_NAME = 'WalletSigner';
export const WALLET_INTERNAL_SERVICE_NAME = 'WalletInternal';
export const WALLET_VAULT_PATH = 'wallet-vault-v1.json';
export const WALLET_STATE_PATH = 'wallet-state-v1.json';

export const DEFAULT_NETWORKS = {
  ethereum: {
    key: 'ethereum:mainnet',
    chain: 'ethereum',
    name: 'Ethereum',
    environment: 'production',
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
  ethereumSepolia: {
    key: 'ethereum:sepolia',
    chain: 'ethereum',
    name: 'Ethereum Sepolia',
    environment: 'development',
    nativeSymbol: 'Sepolia ETH',
    rpcUrl: 'https://sepolia.drpc.org',
    rpcUrls: [
      'https://sepolia.drpc.org',
    ],
    chainId: 11155111,
  },
  solana: {
    key: 'solana:mainnet',
    chain: 'solana',
    name: 'Solana',
    environment: 'production',
    nativeSymbol: 'SOL',
    rpcUrl: 'https://solana-rpc.publicnode.com',
    rpcUrls: [
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com',
    ],
  },
  solanaDevnet: {
    key: 'solana:devnet',
    chain: 'solana',
    name: 'Solana Devnet',
    environment: 'development',
    nativeSymbol: 'Devnet SOL',
    rpcUrl: 'https://api.devnet.solana.com',
    rpcUrls: [
      'https://api.devnet.solana.com',
    ],
  },
} as const;

export const DEFAULT_NETWORK_LIST = Object.values(DEFAULT_NETWORKS);

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
    id: 'ethereum:sepolia:weth',
    chain: 'ethereum',
    networkKey: 'ethereum:sepolia',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
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
  {
    id: 'solana:devnet:usdc',
    chain: 'solana',
    networkKey: 'solana:devnet',
    symbol: 'USDC',
    name: 'Devnet USDC',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
  },
] as const;
