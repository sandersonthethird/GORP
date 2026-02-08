const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyHex = process.env.SHARE_ENCRYPTION_KEY
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('SHARE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  const keyBytes = hexToBytes(keyHex)
  // Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer type issues
  const keyBuffer = new ArrayBuffer(keyBytes.length)
  new Uint8Array(keyBuffer).set(keyBytes)
  return crypto.subtle.importKey('raw', keyBuffer, ALGORITHM, false, ['encrypt', 'decrypt'])
}

export async function encryptApiKey(plaintext: string): Promise<string> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded)
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), IV_LENGTH)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptApiKey(encrypted: string): Promise<string> {
  const key = await getEncryptionKey()
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0))
  const iv = data.slice(0, IV_LENGTH)
  const ciphertext = data.slice(IV_LENGTH)
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function generateToken(length: number = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let result = ''
  for (const byte of bytes) {
    result += BASE62_CHARS[byte % 62]
  }
  return result
}
