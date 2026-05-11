import bs58 from 'bs58';
import { ethers } from 'ethers';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8String(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function normalizeHex(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

// Solana wallets export key material in different common shapes:
// JSON byte array: common from Solana CLI keypair files, e.g. [12,34,...]
// hex / 0x hex: common developer format and what we currently show when revealing the Solana 32-byte seed
// base58: common Solana ecosystem encoding
// base64: common transport/storage encoding
export function parseSecretBytes(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Secret value is empty.');
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as number[];
    return new Uint8Array(parsed);
  }

  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    return ethers.getBytes(`0x${hex}`);
  }

  try {
    return bs58.decode(trimmed);
  } catch {
    return base64ToBytes(trimmed);
  }
}

export function shortAddress(address: string): string {
  if (address.length <= 14) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}
