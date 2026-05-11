import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { ethers } from 'ethers';
import { mnemonicToSeedSync } from '@scure/bip39';
import { derivePath } from 'ed25519-hd-key';
import { Buffer } from 'buffer';
import { base64ToBytes, bytesToBase64, parseSecretBytes, utf8Bytes } from '@/lib/format';
import type { BalanceResult, NetworkConfig, ResolvedAccountSecret, TokenConfig, TransferRequest, TransferResult, WalletAccount } from '@/lib/types';

export type SolanaRpc = <T>(network: NetworkConfig, method: string, params: unknown[], label: string) => Promise<T>;

type SolanaAccountInfoResult = {
  value: unknown | null;
};

type SolanaTokenBalanceResult = {
  value: {
    amount?: string;
  };
};

type SolanaBalanceResult = {
  value: number;
};

type SolanaLatestBlockhashResult = {
  value: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
};

type SolanaSignatureStatusesResult = {
  value: Array<{
    err: unknown | null;
    confirmationStatus?: string | null;
  } | null>;
};

export function solanaKeypairFromSecret(secret: ResolvedAccountSecret): Keypair {
  if (secret.kind === 'mnemonic') {
    if (!secret.mnemonic || !secret.derivationPath) {
      throw new Error('Solana mnemonic account is missing derivation data.');
    }
    const seed = mnemonicToSeedSync(secret.mnemonic);
    const derived = derivePath(secret.derivationPath, Buffer.from(seed).toString('hex')).key;
    return Keypair.fromSeed(derived);
  }
  if (!secret.privateKey) {
    throw new Error('Solana private key account is missing key material.');
  }
  const bytes = parseSecretBytes(secret.privateKey);
  if (bytes.length !== 32) {
    throw new Error('Solana private key import expects a 32-byte seed.');
  }
  return Keypair.fromSeed(bytes);
}

export function solanaPrivateKeyFromSecret(secret: ResolvedAccountSecret): string {
  return ethers.hexlify(solanaKeypairFromSecret(secret).secretKey.slice(0, 32));
}

export function solanaExplorerFor(signature: string, network?: NetworkConfig): string {
  const cluster = network?.key === 'solana:devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}

function formatUnits(raw: bigint, decimals: number): string {
  return ethers.formatUnits(raw, decimals);
}

function parseUnits(value: string, decimals: number): bigint {
  return ethers.parseUnits(value, decimals);
}

export async function getSolanaNativeBalance(
  rpc: SolanaRpc,
  account: WalletAccount,
  network: NetworkConfig,
): Promise<BalanceResult> {
  const result = await rpc<SolanaBalanceResult>(network, 'getBalance', [account.address], 'native balance');
  const raw = result.value;
  return {
    accountId: account.id,
    symbol: network.nativeSymbol,
    raw: String(raw),
    formatted: String(raw / LAMPORTS_PER_SOL),
  };
}

export async function getSolanaTokenBalance(
  rpc: SolanaRpc,
  account: WalletAccount,
  network: NetworkConfig,
  token: TokenConfig,
): Promise<BalanceResult> {
  const tokenAccount = await getAssociatedTokenAddress(
    new PublicKey(token.address),
    new PublicKey(account.address),
  );
  const accountInfo = await rpc<SolanaAccountInfoResult>(network, 'getAccountInfo', [
    tokenAccount.toBase58(),
    { encoding: 'base64' },
  ], `${token.symbol} token account lookup`);
  if (!accountInfo.value) {
    return {
      accountId: account.id,
      symbol: token.symbol,
      raw: '0',
      formatted: formatUnits(0n, token.decimals),
    };
  }
  const balance = await rpc<SolanaTokenBalanceResult>(network, 'getTokenAccountBalance', [
    tokenAccount.toBase58(),
  ], `${token.symbol} token balance`);
  const raw = BigInt(balance.value.amount ?? '0');
  return {
    accountId: account.id,
    symbol: token.symbol,
    raw: raw.toString(),
    formatted: formatUnits(raw, token.decimals),
  };
}

export async function transferSolanaNative(
  rpc: SolanaRpc,
  secret: ResolvedAccountSecret,
  account: WalletAccount,
  network: NetworkConfig,
  request: TransferRequest,
): Promise<TransferResult> {
  const keypair = solanaKeypairFromSecret(secret);
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: new PublicKey(request.to),
    lamports: Number(parseUnits(request.amount, 9)),
  }));
  const signature = await sendSolanaTransaction(rpc, network, transaction, keypair);
  return {
    accountId: account.id,
    chain: account.chain,
    signature,
    status: 'pending',
    explorerUrl: solanaExplorerFor(signature, network),
  };
}

export async function transferSolanaToken(
  rpc: SolanaRpc,
  secret: ResolvedAccountSecret,
  account: WalletAccount,
  network: NetworkConfig,
  token: TokenConfig,
  request: TransferRequest,
): Promise<TransferResult> {
  const keypair = solanaKeypairFromSecret(secret);
  const mint = new PublicKey(token.address);
  const recipient = new PublicKey(request.to);
  const sourceAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
  const recipientAta = await getAssociatedTokenAddress(mint, recipient);
  const transaction = new Transaction();

  if (!(await solanaAccountExists(rpc, network, recipientAta))) {
    transaction.add(createAssociatedTokenAccountInstruction(
      keypair.publicKey,
      recipientAta,
      recipient,
      mint,
    ));
  }

  transaction.add(createTransferInstruction(
    sourceAta,
    recipientAta,
    keypair.publicKey,
    parseUnits(request.amount, token.decimals),
  ));
  const signature = await sendSolanaTransaction(rpc, network, transaction, keypair);
  return {
    accountId: account.id,
    chain: account.chain,
    signature,
    status: 'pending',
    explorerUrl: solanaExplorerFor(signature, network),
  };
}

export async function signSolanaMessage(secret: ResolvedAccountSecret, message: string): Promise<string> {
  const keypair = solanaKeypairFromSecret(secret);
  const nacl = await import('tweetnacl');
  return bytesToBase64(nacl.sign.detached(utf8Bytes(message), keypair.secretKey));
}

export function signSolanaTransaction(secret: ResolvedAccountSecret, transaction: string): string {
  const keypair = solanaKeypairFromSecret(secret);
  const bytes = base64ToBytes(transaction);
  let signedBytes: Uint8Array;
  try {
    const versioned = VersionedTransaction.deserialize(bytes);
    versioned.sign([keypair]);
    signedBytes = versioned.serialize();
  } catch {
    const tx = Transaction.from(bytes);
    tx.partialSign(keypair);
    signedBytes = tx.serialize({ requireAllSignatures: false });
  }
  return bytesToBase64(signedBytes);
}

export async function waitForSolanaConfirmation(
  rpc: SolanaRpc,
  network: NetworkConfig,
  signature: string,
  timeoutMs: number,
): Promise<{ status: TransferResult['status']; confirmedAt?: string; blockNumber?: number }> {
  const startedAt = Date.now();
  let seenPending = false;
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const result = await rpc<SolanaSignatureStatusesResult>(network, 'getSignatureStatuses', [
        [signature],
        { searchTransactionHistory: true },
      ], 'signature status lookup');
      const status = result.value[0];
      if (status) {
        if (status.err) {
          return { status: 'failed', confirmedAt: new Date().toISOString() };
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          return { status: 'success', confirmedAt: new Date().toISOString() };
        }
        seenPending = true;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (err) {
    await w3n.log?.('error', `Wallet could not confirm Solana transaction ${signature}`, err);
  }
  return { status: seenPending ? 'pending' : 'not_included' };
}

async function solanaAccountExists(rpc: SolanaRpc, network: NetworkConfig, publicKey: PublicKey): Promise<boolean> {
  const result = await rpc<SolanaAccountInfoResult>(network, 'getAccountInfo', [
    publicKey.toBase58(),
    { encoding: 'base64' },
  ], 'Solana account lookup');
  return !!result.value;
}

async function sendSolanaTransaction(
  rpc: SolanaRpc,
  network: NetworkConfig,
  transaction: Transaction,
  signer: Keypair,
): Promise<string> {
  const latest = await rpc<SolanaLatestBlockhashResult>(network, 'getLatestBlockhash', [
    { commitment: 'confirmed' },
  ], 'latest blockhash lookup');
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.value.blockhash;
  transaction.sign(signer);
  const rawTransaction = bytesToBase64(transaction.serialize());
  return rpc<string>(network, 'sendTransaction', [
    rawTransaction,
    {
      encoding: 'base64',
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    },
  ], 'transaction broadcast');
}
