import { validate } from 'class-validator';
import {
  isValidStellarAddress,
  IsStellarAddress,
} from './stellar-address.validator';

class TestPayoutDto {
  @IsStellarAddress()
  stellarAddress: unknown;

  constructor(address: unknown) {
    this.stellarAddress = address;
  }
}

class TestCustomMessageDto {
  @IsStellarAddress({ message: 'Custom invalid address error' })
  stellarAddress: unknown;

  constructor(address: unknown) {
    this.stellarAddress = address;
  }
}

describe('isValidStellarAddress', () => {
  const validPublicKey1 =
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const validPublicKey2 =
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  it('accepts a valid G... Ed25519 public key', () => {
    expect(isValidStellarAddress(validPublicKey1)).toBe(true);
    expect(isValidStellarAddress(validPublicKey2)).toBe(true);
  });

  it('rejects an address with an invalid checksum', () => {
    // Flip character at index 10 from 'F' to 'A', invalidating CRC16 checksum
    const badChecksum =
      validPublicKey1.slice(0, 10) + 'A' + validPublicKey1.slice(11);
    expect(isValidStellarAddress(badChecksum)).toBe(false);
  });

  it('rejects an M... muxed account address', () => {
    const muxedAddress =
      'MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJAAAAAAAAMVGA6545K';
    expect(isValidStellarAddress(muxedAddress)).toBe(false);
  });

  it('rejects a C... Soroban contract address', () => {
    const contractAddress =
      'CA3D5KRYMCMCZWHJQJHDAWYZASFTR7BB7IOEQX4DYPSTMA6S67FLS5YQ';
    expect(isValidStellarAddress(contractAddress)).toBe(false);
  });

  it('rejects an S... secret seed', () => {
    const secretSeed =
      'SDAKFNYEIAORZKKCYRILFQKLLOCNPL5SWJ3YYRPO3CACDTNZPT7XTTCV';
    expect(isValidStellarAddress(secretSeed)).toBe(false);
  });

  it('rejects a lowercase key', () => {
    const lower = validPublicKey1.toLowerCase();
    expect(isValidStellarAddress(lower)).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidStellarAddress(null)).toBe(false);
    expect(isValidStellarAddress(undefined)).toBe(false);
    expect(isValidStellarAddress(12345)).toBe(false);
    expect(isValidStellarAddress(true)).toBe(false);
    expect(isValidStellarAddress({})).toBe(false);
    expect(isValidStellarAddress([])).toBe(false);
    expect(isValidStellarAddress(Symbol('G...'))).toBe(false);
  });

  it('rejects empty or malformed strings', () => {
    expect(isValidStellarAddress('')).toBe(false);
    expect(isValidStellarAddress('   ')).toBe(false);
    expect(isValidStellarAddress('not-an-address')).toBe(false);
    expect(isValidStellarAddress('G' + 'A'.repeat(54))).toBe(false);
    expect(isValidStellarAddress(validPublicKey1.slice(0, 50))).toBe(false);
    expect(isValidStellarAddress(validPublicKey1 + 'A')).toBe(false);
  });
});

describe('IsStellarAddress decorator', () => {
  const validPublicKey =
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  it('validates successfully for a valid Stellar address', async () => {
    const dto = new TestPayoutDto(validPublicKey);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails validation for an invalid address with default message', async () => {
    const dto = new TestPayoutDto('invalid-address');
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].constraints?.isStellarAddress).toBe(
      'stellarAddress must be a valid Stellar public key (StrKey-encoded Ed25519 address)',
    );
  });

  it('supports custom validation message options', async () => {
    const dto = new TestCustomMessageDto('invalid-address');
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].constraints?.isStellarAddress).toBe(
      'Custom invalid address error',
    );
  });

  it('fails validation when value is non-string or null', async () => {
    const dto = new TestPayoutDto(null);
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
  });
});
