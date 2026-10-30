import { keepStandInOptions, withStandInOptions } from './stand-in-options';

const KEY = 'pane-default:companion';

describe('withStandInOptions', () => {
  it('starts the options of a default from what it sets', () => {
    expect(withStandInOptions({}, KEY, { headerLargeTitle: false })).toEqual({
      [KEY]: { headerLargeTitle: false },
    });
  });

  it('merges what it sets over what it set before, key by key', () => {
    const all = { [KEY]: { headerLargeTitle: false, headerTitle: '' } };

    expect(
      withStandInOptions(all, KEY, { headerLargeTitle: true, headerTransparent: true }),
    ).toEqual({ [KEY]: { headerLargeTitle: true, headerTitle: '', headerTransparent: true } });
  });

  it('keeps the options of another default', () => {
    const other = { headerShown: false };

    expect(withStandInOptions({ 'pane-default:primary': other }, KEY, { headerTitle: '' })).toEqual(
      {
        'pane-default:primary': other,
        [KEY]: { headerTitle: '' },
      },
    );
  });

  it('hands back the same object when every option is set to its value already', () => {
    const all = { [KEY]: { headerLargeTitle: false, headerTitle: '' } };

    expect(withStandInOptions(all, KEY, { headerTitle: '' })).toBe(all);
    expect(withStandInOptions(all, KEY, { headerLargeTitle: false, headerTitle: '' })).toBe(all);
  });

  it('hands back the same object for options that set nothing', () => {
    const all = { [KEY]: { headerTitle: '' } };

    expect(withStandInOptions(all, KEY, {})).toBe(all);
  });

  it('records an option set to undefined that was never set, since it hides the static value', () => {
    expect(withStandInOptions({}, KEY, { headerTransparent: undefined })).toEqual({
      [KEY]: { headerTransparent: undefined },
    });
    expect(Object.keys(withStandInOptions({}, KEY, { headerTransparent: undefined })[KEY])).toEqual(
      ['headerTransparent'],
    );
  });

  it('changes the object when an option has another value', () => {
    const all = { [KEY]: { headerTitle: '' } };

    expect(withStandInOptions(all, KEY, { headerTitle: 'Statistics' })).not.toBe(all);
  });
});

describe('keepStandInOptions', () => {
  it('drops the options of a default that is not shown', () => {
    const all = { [KEY]: { headerTitle: '' }, 'pane-default:primary': { headerShown: false } };

    expect(keepStandInOptions(all, ['pane-default:primary'])).toEqual({
      'pane-default:primary': { headerShown: false },
    });
    expect(keepStandInOptions(all, [])).toEqual({});
  });

  it('hands back the same object when every default it holds is shown', () => {
    const all = { [KEY]: { headerTitle: '' } };

    expect(keepStandInOptions(all, [KEY, 'pane-default:primary'])).toBe(all);
    expect(keepStandInOptions({}, [])).toStrictEqual({});
  });
});
