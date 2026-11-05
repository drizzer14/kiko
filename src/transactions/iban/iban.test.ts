import { IBAN_PATTERN, ibanKeyOf } from './iban';

const UKRAINIAN_IBAN = 'UA733220010000026201112223334';

describe('ibanKeyOf', () => {
  it('removes every space and uppercases', () => {
    expect(ibanKeyOf('ua73 3220 0100 0002 6201 1122 2333 4')).toBe(UKRAINIAN_IBAN);
  });

  it('removes leading, trailing and repeated spaces', () => {
    expect(ibanKeyOf('  UA73   3220010000026201112223334  ')).toBe(UKRAINIAN_IBAN);
  });

  it('leaves a key as it is', () => {
    expect(ibanKeyOf(UKRAINIAN_IBAN)).toBe(UKRAINIAN_IBAN);
  });

  it('gives the same key for one IBAN in any spelling', () => {
    expect(ibanKeyOf('Ua73 3220 0100 0002 6201 1122 2333 4')).toBe(ibanKeyOf(UKRAINIAN_IBAN));
  });

  it('gives a blank text an empty key', () => {
    expect(ibanKeyOf('   ')).toBe('');
  });
});

describe('IBAN_PATTERN', () => {
  const bodyOf = (length: number): string => `UA73${'1'.repeat(length)}`;

  it('accepts an IBAN in its key form', () => {
    expect(IBAN_PATTERN.test(UKRAINIAN_IBAN)).toBe(true);
  });

  it('accepts what ibanKeyOf makes of a spaced lower-case IBAN', () => {
    expect(IBAN_PATTERN.test(ibanKeyOf('ua73 3220 0100 0002 6201 1122 2333 4'))).toBe(true);
  });

  it('accepts a bad checksum, because no checksum is read', () => {
    expect(IBAN_PATTERN.test('UA11111111111111111111111111')).toBe(true);
  });

  it.each([
    ['the shortest body', bodyOf(11), true],
    ['one character under the shortest body', bodyOf(10), false],
    ['the longest body', bodyOf(30), true],
    ['one character over the longest body', bodyOf(31), false],
  ])('judges %s', (_label, iban, expected) => {
    expect(IBAN_PATTERN.test(iban)).toBe(expected);
  });

  it.each([
    ['lower case', 'ua733220010000026201112223334'],
    ['spaces', 'UA73 3220 0100 0002 6201 1122 2333 4'],
    ['a digit in the country code', '1A733220010000026201112223334'],
    ['a letter in the check digits', 'UAX3322001000002620111222333'],
    ['text before the IBAN', ` ${UKRAINIAN_IBAN}`],
    ['text after the IBAN', `${UKRAINIAN_IBAN}!`],
    ['an empty string', ''],
  ])('refuses %s', (_label, iban) => {
    expect(IBAN_PATTERN.test(iban)).toBe(false);
  });

  it('gives the same answer when it reads the same text twice', () => {
    expect(IBAN_PATTERN.test(UKRAINIAN_IBAN)).toBe(true);
    expect(IBAN_PATTERN.test(UKRAINIAN_IBAN)).toBe(true);
  });
});
