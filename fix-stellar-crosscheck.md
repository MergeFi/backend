# Fix: STELLAR_NETWORK and passphrase cross-check (closes #611)

STELLAR_NETWORK and STELLAR_NETWORK_PASSPHRASE are never cross-checked. A misconfiguration (e.g. PUBLIC network with TESTNET passphrase) silently corrupts escrow state.

Added validation at startup that verifies the passphrase matches the configured network.

Stellar Wave bounty wallet: 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A
