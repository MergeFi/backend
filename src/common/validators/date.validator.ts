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
          // Accept a Date as well as a string so the decorator still works on
          // a field that is also transformed with `@Type(() => Date)` (#743).
          // Numbers are rejected: an epoch timestamp is ambiguous (s vs ms).
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
