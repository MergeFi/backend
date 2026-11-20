// Lightweight Jest manual mock for @stellar/stellar-sdk.
//
// The real package ships nested ESM-only dependencies (@noble/hashes,
// uint8array-extras, etc.) that Jest's CommonJS transform can't parse
// without a much heavier babel/ESM setup. Most unit tests never exercise the
// real Stellar network — SorobanClientService itself is always mocked at the
// DI boundary in tests — so we stub just enough of the surface for those
// modules to import without throwing at module-load time.
//
// The exception is StrKey + Keypair.fromPublicKey: the ownership-proof
// verifier (src/users/stellar-ownership.ts) needs a real Ed25519 check so its
// regression specs can distinguish a valid signature from a forged one. Those
// two are implemented here with Node's crypto module (SEP-23 StrKey encoding:
// version byte + 32-byte key + CRC16-XModem, base32 without padding).
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ED25519_PUBLIC_KEY_VERSION = 6 << 3; // 'G' addresses

function crc16xmodem(buf) {
  let crc = 0;
  for (const byte of buf) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const StrKey = {
  encodeEd25519PublicKey(raw) {
    const payload = Buffer.concat([Buffer.from([ED25519_PUBLIC_KEY_VERSION]), raw]);
    const crc = crc16xmodem(payload);
    return base32Encode(Buffer.concat([payload, Buffer.from([crc & 0xff, crc >> 8])]));
  },
  decodeEd25519PublicKey(address) {
    const buf = typeof address === 'string' ? base32Decode(address) : null;
    if (!buf || buf.length !== 35 || buf[0] !== ED25519_PUBLIC_KEY_VERSION) {
      throw new Error('invalid Ed25519 public key');
    }
    const payload = buf.subarray(0, 33);
    if (crc16xmodem(payload) !== buf[33] + (buf[34] << 8)) {
      throw new Error('invalid Ed25519 public key checksum');
    }
    return buf.subarray(1, 33);
  },
  isValidEd25519PublicKey(address) {
    try {
      StrKey.decodeEd25519PublicKey(address);
      return true;
    } catch {
      return false;
    }
  },
};

class Contract {
  call() {
    return {};
  }
}

class Address {
  constructor(value) {
    this.value = value;
  }
  toScVal() {
    return this.value;
  }
}

class Keypair {
  static fromSecret() {
    return { publicKey: () => 'MOCK_PUBLIC_KEY', sign: () => undefined };
  }
  // Verifies an Ed25519 signature over `data` (the raw bytes the SDK signs,
  // i.e. the SEP-53 digest), matching js-stellar-base's Keypair#verify.
  static fromPublicKey(address) {
    const raw = StrKey.decodeEd25519PublicKey(address);
    const key = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
      format: 'jwk',
    });
    return {
      verify(data, signature) {
        return crypto.verify(null, data, key, signature);
      },
    };
  }
}

class TransactionBuilder {
  constructor() {}
  addOperation() {
    return this;
  }
  setTimeout() {
    return this;
  }
  build() {
    return { sign: () => undefined };
  }
}

module.exports = {
  Contract,
  Address,
  Keypair,
  StrKey,
  TransactionBuilder,
  BASE_FEE: '100',
  Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
  nativeToScVal: (v) => v,
  scValToNative: (v) => v,
  rpc: {
    Server: class Server {
      async getAccount() {
        return {};
      }
      async simulateTransaction() {
        return {};
      }
      async sendTransaction() {
        return { status: 'PENDING', hash: 'mock-hash' };
      }
      async getTransaction() {
        return { status: 'SUCCESS', ledger: 1 };
      }
    },
    Api: {
      isSimulationError: () => false,
      GetTransactionStatus: { NOT_FOUND: 'NOT_FOUND', SUCCESS: 'SUCCESS' },
    },
    assembleTransaction: (tx) => ({ build: () => tx }),
  },
};
