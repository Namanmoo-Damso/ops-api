import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsValidPhone', async: false })
export class PhoneNumberValidator implements ValidatorConstraintInterface {
  validate(value: string) {
    if (typeof value !== 'string') return false;
    const normalized = value.replace(/-/g, '');
    if (normalized.length < 7 || normalized.length > 15) {
      return false;
    }
    return /^[\d-]+$/.test(value);
  }

  defaultMessage(_: ValidationArguments) {
    return '전화번호는 숫자와 하이픈으로 구성된 7~15자리여야 합니다.';
  }
}

export function IsValidPhone(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: 'IsValidPhone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: PhoneNumberValidator,
    });
  };
}
