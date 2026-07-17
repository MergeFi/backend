import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { AssetType } from '../enums';

const STROOP_SCALE = 10_000_000n;
const MAX_MAJOR_UNITS = 100_000_000n;

export const MAX_MONETARY_AMOUNT = MAX_MAJOR_UNITS.toString();
export const SUPPORTED_ESCROW_ASSETS = [AssetType.USDC, AssetType.XLM] as const;

export function isValidMoneyAmount(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^(0|[1-9]\d*)(\.\d{1,7})?$/.test(value)) return false;

  const [whole, fraction = ''] = value.split('.');
  const stroops =
    BigInt(whole) * STROOP_SCALE + BigInt(fraction.padEnd(7, '0'));

  return stroops > 0n && stroops <= MAX_MAJOR_UNITS * STROOP_SCALE;
}

export function amountToStroops(amount: string): bigint {
  if (!isValidMoneyAmount(amount)) {
    throw new Error(
      `Amount must be a positive decimal string with at most 7 fractional digits and no more than ${MAX_MONETARY_AMOUNT}`,
    );
  }

  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * STROOP_SCALE + BigInt(fraction.padEnd(7, '0'));
}

export function isSupportedEscrowAsset(value: unknown): value is AssetType {
  return SUPPORTED_ESCROW_ASSETS.includes(value as AssetType);
}

export function IsMoneyAmount(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMoneyAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isValidMoneyAmount(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a positive decimal string with at most 7 fractional digits and no more than ${MAX_MONETARY_AMOUNT}`;
        },
      },
    });
  };
}

export function IsSupportedEscrowAsset(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSupportedEscrowAsset',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return isSupportedEscrowAsset(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a supported escrow asset: ${SUPPORTED_ESCROW_ASSETS.join(', ')}`;
        },
      },
    });
  };
}
