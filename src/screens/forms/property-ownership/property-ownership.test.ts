import { enteredShare, ownershipEntryOf } from './property-ownership';

const third = { numerator: 1, denominator: 3 };
const whole = { numerator: 1, denominator: 1 };

describe('ownershipEntryOf', () => {
  it('fills both input forms from one share', () => {
    expect(ownershipEntryOf('fraction', third)).toEqual({
      mode: 'fraction',
      percent: '33.33',
      numerator: '1',
      denominator: '3',
    });
  });
});

describe('enteredShare', () => {
  it('reads the percent field in percent mode', () => {
    expect(enteredShare({ ...ownershipEntryOf('percent', whole), percent: '50' }, whole)).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });

  it('reads the two fraction fields in fraction mode', () => {
    const entry = { ...ownershipEntryOf('fraction', whole), numerator: '2', denominator: '6' };

    expect(enteredShare(entry, whole)).toEqual(third);
  });

  it('keeps the share in effect when the percent shows the same rounded value', () => {
    expect(enteredShare(ownershipEntryOf('percent', third), third)).toEqual(third);
    expect(
      enteredShare({ ...ownershipEntryOf('percent', third), percent: '33,33' }, third),
    ).toEqual(third);
  });

  it('is null for a share that does not parse', () => {
    expect(enteredShare({ ...ownershipEntryOf('percent', whole), percent: '0' }, whole)).toBeNull();
    expect(
      enteredShare(
        { ...ownershipEntryOf('fraction', whole), numerator: '2', denominator: '1' },
        whole,
      ),
    ).toBeNull();
  });
});
