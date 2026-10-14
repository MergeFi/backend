# Spec: config/validate-required-config.ts (closes #600)

Added missing test spec file for validate-required-config.ts

Verifies that:
- ESCROW_DEADLINE_SECONDS is parsed as positive integer
- PORT is parsed as valid port number (1-65535)
- Missing required env vars throw clear error messages

Stellar Wave bounty wallet: 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A
