import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Checks whether a given string is a valid Stellar public key (StrKey encoding,
 * Ed25519 G... format with valid CRC16 checksum).
 */
export function isValidStellarAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value) return false;
  return StrKey.isValidEd25519PublicKey(value);
}

/**
 * Class-validator decorator requiring the decorated property to be a valid
 * Stellar Ed25519 public key.
 */
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
          return `${args.property} must be a valid Stellar public key (Ed25519 StrKey format starting with 'G')`;
        },
      },
    });
  };
}
