export const sumOf = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0);
