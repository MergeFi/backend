import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Validates that an ISO-8601 string or Date object represents a timestamp strictly in the future.
 */
export function isFutureDate(value: unknown): boolean {
  if (typeof value !== 'string' && !(value instanceof Date)) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

export function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          return isFutureDate(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid ISO-8601 date string in the future`;
        },
      },
    });
  };
}
