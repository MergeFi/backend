import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Backed by the SDK's own StrKey checksum validation (base32 decode +
 * version byte + CRC16 checksum over the payload) rather than a hand-rolled
 * regex, so a syntactically-plausible-but-checksum-invalid address is
 * rejected the same as an obviously malformed one (#60).
 */
export function isValidStellarAddress(value: unknown): value is string {
  return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
}

export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isValidStellarAddress(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Stellar public key (StrKey-encoded Ed25519 address)`;
        },
      },
    });
  };
}
