import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const date = new Date(value);
          return !isNaN(date.getTime()) && date.getTime() > Date.now();
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a date strictly in the future`;
        },
      },
    });
  };
}
