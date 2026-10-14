# Spec: common/validators/money.validator.ts (closes #603)

Added missing test spec file for money.validator.ts

Verifies that:
- Valid monetary amounts are accepted
- Invalid formats (negative, NaN, non-numeric) are rejected
- Edge cases (0, very large numbers) handled correctly

Stellar Wave bounty wallet: 0x53dbe1b36BA3BEAC6cEf6cD22AD50E362DBcB23A
