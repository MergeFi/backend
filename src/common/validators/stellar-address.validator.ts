import { registerDecorator, ValidationOptions } from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validates that the decorated property is a valid Stellar Ed25519 public key (StrKey G...).
 */
export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') {
            return false;
          }
          return StrKey.isValidEd25519PublicKey(value);
        },
        defaultMessage() {
          return '$property must be a valid Stellar public key (StrKey G...)';
        },
      },
    });
  };
}
