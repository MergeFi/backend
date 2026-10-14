import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  IsStellarAddress,
  isValidStellarAddress,
} from './stellar-address.validator';

// A real StrKey-encoded Ed25519 public key (the well-known all-zero account).
const VALID_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const INVALID_ADDRESS = 'GNOTAREALADDRESS';
const VALID_BUT_DIFFERENT =
  'GBAH7U26BFLUPP2E5SUJF2UU2NAWM2KQZJ5RVLQZPE2XAWK3WRLJ3EK6';

class TestDto {
  @IsStellarAddress()
  address!: string;
}

describe('stellar-address.validator', () => {
  describe('isValidStellarAddress', () => {
    it('accepts a valid StrKey Ed25519 public key', () => {
      expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true);
      expect(isValidStellarAddress(VALID_BUT_DIFFERENT)).toBe(true);
    });

    it('rejects a syntactically-wrong address', () => {
      expect(isValidStellarAddress(INVALID_ADDRESS)).toBe(false);
      expect(isValidStellarAddress('hello')).toBe(false);
    });

    it('rejects a plausible-but-checksum-invalid address', () => {
      // Same length + G-prefix, last char swapped — fails the CRC16 checksum.
      const tampered = VALID_ADDRESS.slice(0, -1) + 'X';
      expect(isValidStellarAddress(tampered)).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isValidStellarAddress(123)).toBe(false);
      expect(isValidStellarAddress(null)).toBe(false);
      expect(isValidStellarAddress(undefined)).toBe(false);
      expect(isValidStellarAddress({})).toBe(false);
    });
  });

  describe('@IsStellarAddress decorator', () => {
    it('passes validation on a valid address', async () => {
      const dto = plainToInstance(TestDto, { address: VALID_ADDRESS });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('fails validation on an invalid address', async () => {
      const dto = plainToInstance(TestDto, { address: INVALID_ADDRESS });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
