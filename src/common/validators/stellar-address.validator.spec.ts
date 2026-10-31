import { validate } from 'class-validator';
import {
  isValidStellarAddress,
  IsStellarAddress,
} from './stellar-address.validator';

// The jest config maps @stellar/stellar-sdk to a lightweight mock that has no
// StrKey, so this spec substitutes a real StrKey-equivalent implementation
// (base32 + version byte + CRC16-XModem) instead of depending on the mock.
jest.mock('@stellar/stellar-sdk', () => {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const crc16 = (bytes: number[]): number => {
    let crc = 0;
    for (const b of bytes) {
      crc ^= b << 8;
      for (let i = 0; i < 8; i++) {
        crc =
          crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  };
  const decode = (s: string): number[] | null => {
    let bits = 0;
    let acc = 0;
    const out: number[] = [];
    for (const ch of s) {
      const v = ALPHABET.indexOf(ch);
      if (v < 0) return null;
      acc = (acc << 5) | v;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 0xff);
      }
    }
    return out;
  };
  return {
    StrKey: {
      isValidEd25519PublicKey: (s: string): boolean => {
        if (s.length !== 56 || s[0] !== 'G') return false;
        const bytes = decode(s);
        if (!bytes || bytes.length !== 35) return false;
        const payload = bytes.slice(0, 33);
        const crc = crc16(payload);
        return bytes[33] === (crc & 0xff) && bytes[34] === crc >> 8;
      },
    },
  };
});

const VALID = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

class Dto {
  @IsStellarAddress()
  address!: unknown;
}

describe('isValidStellarAddress', () => {
  it('accepts a valid G… public key', () => {
    expect(isValidStellarAddress(VALID)).toBe(true);
  });

  it('rejects a key with a bad checksum', () => {
    const bad = VALID.slice(0, -1) + (VALID.endsWith('A') ? 'B' : 'A');
    expect(isValidStellarAddress(bad)).toBe(false);
  });

  it('rejects M… (muxed) and C… (contract) addresses', () => {
    expect(isValidStellarAddress('M' + VALID.slice(1))).toBe(false);
    expect(isValidStellarAddress('C' + VALID.slice(1))).toBe(false);
  });

  it('rejects a lowercase key', () => {
    expect(isValidStellarAddress(VALID.toLowerCase())).toBe(false);
  });

  it('rejects wrong lengths and empty strings', () => {
    expect(isValidStellarAddress(VALID.slice(0, -1))).toBe(false);
    expect(isValidStellarAddress('')).toBe(false);
  });

  it.each([undefined, null, 123, {}, [], true])(
    'rejects non-string %p',
    (value) => {
      expect(isValidStellarAddress(value)).toBe(false);
    },
  );
});

describe('@IsStellarAddress', () => {
  it('passes a valid address', async () => {
    const dto = Object.assign(new Dto(), { address: VALID });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('fails an invalid address with the property name in the message', async () => {
    const dto = Object.assign(new Dto(), { address: 'nope' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isStellarAddress).toContain(
      'address must be a valid Stellar public key',
    );
  });
});
