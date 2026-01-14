import { Transform } from 'class-transformer';

export const TransformEmptyToNull = () =>
  Transform(({ value }) => (value === '' ? null : value));

export const TransformEmptyToUndefined = () =>
  Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  );
