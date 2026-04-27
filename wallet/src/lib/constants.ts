export const WALLET_SERVICE_NAME = 'WalletSigner';

export const DEFAULT_NETWORKS = {
  ethereum: {
    key: 'ethereum:mainnet',
    chain: 'ethereum',
    name: 'Ethereum',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    chainId: 1,
  },
  solana: {
    key: 'solana:mainnet',
    chain: 'solana',
    name: 'Solana',
    nativeSymbol: 'SOL',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  },
} as const;

export const DEFAULT_TOKENS = [
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
