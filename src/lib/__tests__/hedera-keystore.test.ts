/**
 * @jest-environment jsdom
 */

/**
 * Tests for client-side Hedera keystore
 * Tests localStorage key management and transaction signing helpers
 */

// Polyfill Web Crypto and TextEncoder for jsdom
import { webcrypto } from 'crypto';
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
}
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', { value: NodeTextEncoder });
  Object.defineProperty(globalThis, 'TextDecoder', { value: NodeTextDecoder });
}

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// Mock @hashgraph/sdk
const mockPublicKey = {
  toStringDer: () => 'mock-public-key-der',
};
const mockPrivateKey = {
  toStringDer: () => 'mock-private-key-der',
  publicKey: mockPublicKey,
};
const mockTransaction = {
  sign: jest.fn().mockResolvedValue(undefined),
  toBytes: () => new Uint8Array([1, 2, 3]),
};

jest.mock('@hashgraph/sdk', () => ({
  PrivateKey: {
    generateED25519: () => mockPrivateKey,
    fromStringDer: (der: string) => {
      if (der === 'invalid-key') throw new Error('Invalid key');
      return mockPrivateKey;
    },
  },
  Transaction: {
    fromBytes: () => mockTransaction,
  },
}));

import {
  hasKeypair,
  generateKeypair,
  getStoredPublicKey,
  signTransaction,
  exportKey,
  importKey,
  validateImportedKey,
  clearKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
} from '../hedera-keystore';

describe('hedera-keystore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  describe('hasKeypair', () => {
    it('returns false when no key stored', () => {
      expect(hasKeypair()).toBe(false);
    });

    it('returns true when key is stored', () => {
      localStorageMock.setItem('folio:hedera:privateKey', 'some-key');
      expect(hasKeypair()).toBe(true);
    });
  });

  describe('generateKeypair', () => {
    it('generates and stores keypair', async () => {
      const result = await generateKeypair();
      expect(result.privateKeyDer).toBe('mock-private-key-der');
      expect(result.publicKeyDer).toBe('mock-public-key-der');
      expect(localStorageMock.getItem('folio:hedera:privateKey')).toBe('mock-private-key-der');
      expect(localStorageMock.getItem('folio:hedera:publicKey')).toBe('mock-public-key-der');
    });
  });

  describe('getStoredPublicKey', () => {
    it('returns null when no key', () => {
      expect(getStoredPublicKey()).toBeNull();
    });

    it('returns public key when stored', () => {
      localStorageMock.setItem('folio:hedera:publicKey', 'pub-key');
      expect(getStoredPublicKey()).toBe('pub-key');
    });
  });

  describe('signTransaction', () => {
    it('throws when no private key stored', async () => {
      await expect(signTransaction(new Uint8Array([1]))).rejects.toThrow('No private key found');
    });

    it('signs transaction when key is stored', async () => {
      localStorageMock.setItem('folio:hedera:privateKey', 'mock-private-key-der');
      const result = await signTransaction(new Uint8Array([1, 2]));
      expect(mockTransaction.sign).toHaveBeenCalled();
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('exportKey', () => {
    it('returns null when no key', () => {
      expect(exportKey()).toBeNull();
    });

    it('returns private key DER', () => {
      localStorageMock.setItem('folio:hedera:privateKey', 'my-secret-key');
      expect(exportKey()).toBe('my-secret-key');
    });
  });

  describe('importKey', () => {
    it('stores the provided key', () => {
      importKey('imported-key-der');
      expect(localStorageMock.getItem('folio:hedera:privateKey')).toBe('imported-key-der');
    });
  });

  describe('validateImportedKey', () => {
    it('derives and stores public key from private key', async () => {
      localStorageMock.setItem('folio:hedera:privateKey', 'valid-key');
      const pubKey = await validateImportedKey();
      expect(pubKey).toBe('mock-public-key-der');
      expect(localStorageMock.getItem('folio:hedera:publicKey')).toBe('mock-public-key-der');
    });

    it('throws when no key stored', async () => {
      await expect(validateImportedKey()).rejects.toThrow('No key to validate');
    });
  });

  describe('clearKeypair', () => {
    it('removes both keys from storage', () => {
      localStorageMock.setItem('folio:hedera:privateKey', 'pk');
      localStorageMock.setItem('folio:hedera:publicKey', 'pub');
      clearKeypair();
      expect(localStorageMock.getItem('folio:hedera:privateKey')).toBeNull();
      expect(localStorageMock.getItem('folio:hedera:publicKey')).toBeNull();
    });
  });

  describe('encryptPrivateKey / decryptPrivateKey', () => {
    it('encrypts and decrypts a key with a passphrase', async () => {
      const originalKey = '302e020100300506032b6570042204200000000000000000000000000000000000000000000000000000000000000001';
      const passphrase = 'test-passphrase-123';

      const { encryptedKey, salt, iv } = await encryptPrivateKey(originalKey, passphrase);

      // Encrypted output should be base64 strings
      expect(typeof encryptedKey).toBe('string');
      expect(typeof salt).toBe('string');
      expect(typeof iv).toBe('string');
      expect(encryptedKey).not.toBe(originalKey);

      // Decrypt should recover the original key
      const decrypted = await decryptPrivateKey(encryptedKey, salt, iv, passphrase);
      expect(decrypted).toBe(originalKey);
    });

    it('fails to decrypt with wrong passphrase', async () => {
      const originalKey = 'test-private-key-der';
      const { encryptedKey, salt, iv } = await encryptPrivateKey(originalKey, 'correct-passphrase');

      await expect(
        decryptPrivateKey(encryptedKey, salt, iv, 'wrong-passphrase')
      ).rejects.toThrow();
    });

    it('produces different ciphertext for same key with different passphrases', async () => {
      const key = 'same-private-key';
      const result1 = await encryptPrivateKey(key, 'passphrase-1');
      const result2 = await encryptPrivateKey(key, 'passphrase-2');

      // Different passphrases should produce different encrypted output
      expect(result1.encryptedKey).not.toBe(result2.encryptedKey);
    });

    it('produces different ciphertext for same key and passphrase (random salt/iv)', async () => {
      const key = 'same-private-key';
      const passphrase = 'same-passphrase';
      const result1 = await encryptPrivateKey(key, passphrase);
      const result2 = await encryptPrivateKey(key, passphrase);

      // Random salt means different output each time
      expect(result1.salt).not.toBe(result2.salt);
      expect(result1.iv).not.toBe(result2.iv);

      // But both should decrypt to the same key
      const dec1 = await decryptPrivateKey(result1.encryptedKey, result1.salt, result1.iv, passphrase);
      const dec2 = await decryptPrivateKey(result2.encryptedKey, result2.salt, result2.iv, passphrase);
      expect(dec1).toBe(key);
      expect(dec2).toBe(key);
    });
  });
});
