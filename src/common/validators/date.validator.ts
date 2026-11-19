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
          // Accept an already-transformed Date (a DTO using @Type(() => Date))
          // as well as the raw string. Numbers are rejected rather than read
          // as epoch milliseconds (#818).
          let date: Date;
          if (value instanceof Date) date = value;
          else if (typeof value === 'string' && value.trim() !== '')
            date = new Date(value);
          else return false;
          return !isNaN(date.getTime()) && date.getTime() > Date.now();
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a date strictly in the future`;
        },
      },
    });
  };
}
