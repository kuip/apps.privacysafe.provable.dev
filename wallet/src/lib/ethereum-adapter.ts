import { ethers } from 'ethers';
import type { BalanceResult, NetworkConfig, ResolvedAccountSecret, TokenConfig, TransferRequest, TransferResult, WalletAccount } from '@/lib/types';

export type EthereumRpc = <T>(network: NetworkConfig, method: string, params: unknown[], label: string) => Promise<T>;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];
const ERC20_INTERFACE = new ethers.Interface(ERC20_ABI);

export type EthereumTransactionReceiptResult = {
  blockNumber?: string;
  status?: string;
} | null;

export function ethereumWalletFromSecret(secret: ResolvedAccountSecret): ethers.Wallet | ethers.HDNodeWallet {
  if (secret.kind === 'mnemonic') {
    if (!secret.mnemonic || !secret.derivationPath) {
      throw new Error('Ethereum mnemonic account is missing derivation data.');
    }
    return ethers.HDNodeWallet.fromPhrase(secret.mnemonic, undefined, secret.derivationPath);
  }
  if (!secret.privateKey) {
    throw new Error('Ethereum private key account is missing key material.');
  }
  const trimmed = secret.privateKey.trim();
  return new ethers.Wallet(trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`);
}

function formatUnits(raw: bigint, decimals: number): string {
  return ethers.formatUnits(raw, decimals);
}

function parseUnits(value: string, decimals: number): bigint {
  return ethers.parseUnits(value, decimals);
}

function ethereumProvider(network: NetworkConfig): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(network.rpcUrl, network.chainId);
}

function ethereumExplorer(txHash: string): string {
  return `https://etherscan.io/tx/${txHash}`;
}

export function ethereumExplorerFor(network: NetworkConfig, txHash: string): string {
  if (network.key === 'ethereum:sepolia') {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  }
  if (network.key === 'ethereum:hoodi') {
    return `https://hoodi.etherscan.io/tx/${txHash}`;
  }
  return ethereumExplorer(txHash);
}

export async function getEthereumNativeBalance(
  rpc: EthereumRpc,
  account: WalletAccount,
  network: NetworkConfig,
): Promise<BalanceResult> {
  const rawHex = await rpc<string>(network, 'eth_getBalance', [account.address, 'latest'], 'native balance');
  const raw = BigInt(rawHex);
  return {
    accountId: account.id,
    symbol: network.nativeSymbol,
    raw: raw.toString(),
    formatted: formatUnits(raw, 18),
  };
}

export async function getEthereumTokenBalance(
  rpc: EthereumRpc,
  account: WalletAccount,
  network: NetworkConfig,
  token: TokenConfig,
): Promise<BalanceResult> {
  const data = ERC20_INTERFACE.encodeFunctionData('balanceOf', [account.address]);
  const rawHex = await rpc<string>(
    network,
    'eth_call',
    [{ to: token.address, data }, 'latest'],
    `${token.symbol} token balance`,
  );
  const [raw] = ERC20_INTERFACE.decodeFunctionResult('balanceOf', rawHex) as unknown as [bigint];
  return {
    accountId: account.id,
    symbol: token.symbol,
    raw: raw.toString(),
    formatted: formatUnits(raw, token.decimals),
  };
}

export async function transferEthereumNative(
  secret: ResolvedAccountSecret,
  account: WalletAccount,
  network: NetworkConfig,
  request: TransferRequest,
): Promise<TransferResult> {
  const wallet = ethereumWalletFromSecret(secret).connect(ethereumProvider(network));
  const tx = await wallet.sendTransaction({
    to: request.to,
    value: parseUnits(request.amount, 18),
  });
  return {
    accountId: account.id,
    chain: account.chain,
    signature: tx.hash,
    status: 'pending',
    explorerUrl: ethereumExplorerFor(network, tx.hash),
  };
}

export async function transferEthereumToken(
  secret: ResolvedAccountSecret,
  account: WalletAccount,
  network: NetworkConfig,
  token: TokenConfig,
  request: TransferRequest,
): Promise<TransferResult> {
  const wallet = ethereumWalletFromSecret(secret).connect(ethereumProvider(network));
  const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
  const tx = await contract.transfer(request.to, parseUnits(request.amount, token.decimals));
  return {
    accountId: account.id,
    chain: account.chain,
    signature: tx.hash,
    status: 'pending',
    explorerUrl: ethereumExplorerFor(network, tx.hash),
  };
}

export async function signEthereumMessage(secret: ResolvedAccountSecret, message: string): Promise<string> {
  return ethereumWalletFromSecret(secret).signMessage(message);
}

export async function signEthereumTransaction(
  secret: ResolvedAccountSecret,
  transaction: unknown,
): Promise<string> {
  return ethereumWalletFromSecret(secret).signTransaction(transaction as ethers.TransactionRequest);
}

export async function waitForEthereumConfirmation(
  rpc: EthereumRpc,
  network: NetworkConfig,
  txHash: string,
  timeoutMs: number,
): Promise<{ status: TransferResult['status']; confirmedAt?: string; blockNumber?: number }> {
  const startedAt = Date.now();
  let seenPending = false;
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const receipt = await rpc<EthereumTransactionReceiptResult>(
        network,
        'eth_getTransactionReceipt',
        [txHash],
        'transaction receipt lookup',
      );
      if (receipt) {
        const blockNumber = receipt.blockNumber ? Number.parseInt(receipt.blockNumber, 16) : undefined;
        return {
          status: receipt.status === '0x1' ? 'success' : 'failed',
          confirmedAt: new Date().toISOString(),
          blockNumber,
        };
      }
      seenPending = true;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (err) {
    await w3n.log?.('error', `Wallet could not confirm Ethereum transaction ${txHash}`, err);
  }
  return { status: seenPending ? 'pending' : 'not_included' };
}
