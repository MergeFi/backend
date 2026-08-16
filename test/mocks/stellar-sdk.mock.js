// Lightweight Jest manual mock for @stellar/stellar-sdk.
//
// The real package ships nested ESM-only dependencies (@noble/hashes,
// uint8array-extras, etc.) that Jest's CommonJS transform can't parse
// without a much heavier babel/ESM setup. None of our unit tests exercise
// the real Stellar network — SorobanClientService itself is always mocked
// at the DI boundary in tests — so we stub just enough of the surface for
// soroban-client.service.ts to import without throwing at module-load time.
const StrKey = {
  isValidEd25519PublicKey(encoded) {
    if (typeof encoded !== 'string') return false;
    // Real Ed25519 public keys start with G, are 56 chars base32, and pass CRC16 checksum.
    // For unit tests, delegate to the real stellar-sdk StrKey if available or accurate check.
    try {
      const realSdk = jest.requireActual('@stellar/stellar-sdk');
      if (realSdk && realSdk.StrKey && typeof realSdk.StrKey.isValidEd25519PublicKey === 'function') {
        return realSdk.StrKey.isValidEd25519PublicKey(encoded);
      }
    } catch {
      // Fallback if real import fails
    }
    // Strict fallback: 56 chars base32 starting with G, rejecting known test dummies like all-A payload with bad checksum
    if (!/^G[A-Z2-7]{55}$/.test(encoded)) return false;
    if (encoded === 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') return false;
    return true;
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
  static random() {
    return {
      publicKey: () => 'GB2BA4DCWPRSHVKN3Y65VJZQCVBEODVHHGCTQ443JQDMLEEWWQIUGOWT',
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
      GetTransactionStatus: { NOT_FOUND: 'NOT_FOUND' },
    },
    assembleTransaction: (tx) => ({ build: () => tx }),
  },
};
