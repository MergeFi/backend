// Lightweight Jest manual mock for @stellar/stellar-sdk.
//
// The real package ships nested ESM-only dependencies (@noble/hashes,
// uint8array-extras, etc.) that Jest's CommonJS transform can't parse
// without a much heavier babel/ESM setup. None of our unit tests exercise
// the real Stellar network — SorobanClientService itself is always mocked
// at the DI boundary in tests — so we stub just enough of the surface for
// soroban-client.service.ts to import without throwing at module-load time.
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

// Faithful StrKey check for Ed25519 public keys: base32 decode, version
// byte 6<<3 ('G'), 35-byte frame, CRC16-XModem trailer — the same algorithm
// the real SDK applies, kept here so specs can exercise checksum-invalid
// addresses without dragging in the ESM-only dependency tree.
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VERSION_ACCOUNT_ID = 6 << 3;

function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out;
}

const StrKey = {
  isValidEd25519PublicKey(value) {
    if (typeof value !== 'string' || value.length !== 56 || value[0] !== 'G') {
      return false;
    }
    const decoded = base32Decode(value);
    if (!decoded || decoded.length !== 35) return false;
    if (decoded[0] !== VERSION_ACCOUNT_ID) return false;
    const expected = crc16Xmodem(decoded.slice(0, 33));
    return decoded[33] === (expected & 0xff) && decoded[34] === (expected >> 8);
  },
};

module.exports = {
  StrKey,
  Contract,
  Address,
  Keypair,
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
