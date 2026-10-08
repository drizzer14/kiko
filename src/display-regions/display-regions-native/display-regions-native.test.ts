import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import { type DisplayRegionsSnapshot, displayRegionsNative, FALLBACK_SNAPSHOT } from '.';

// Read through the registry, not a value import: only the wrapper may load
// the native module.
const nativeModule = jest.mocked(
  (jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: Spec }).default,
);

const duoSnapshot: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'regular',
  verticalBarEdge: 'trailing',
  foldRegion: { x: 470, y: 0, width: 11, height: 669 },
};

const captureEmitter = (): { emit: (payload: string) => void } => {
  const capture = { emit: (_payload: string): void => undefined };

  nativeModule.onChange.mockImplementationOnce((handler) => {
    capture.emit = handler;

    return { remove: jest.fn() };
  });

  return capture;
};

describe('displayRegionsNative.getSnapshot', () => {
  it('parses the JSON the native module returns', () => {
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(duoSnapshot));

    expect(displayRegionsNative.getSnapshot()).toEqual(duoSnapshot);
  });

  it('parses a flat snapshot with no fold region', () => {
    const flatSnapshot: DisplayRegionsSnapshot = {
      horizontalSizeClass: 'compact',
      verticalBarEdge: 'none',
      foldRegion: null,
    };
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(flatSnapshot));

    expect(displayRegionsNative.getSnapshot()).toEqual(flatSnapshot);
  });

  it('returns the same object while the native JSON is unchanged', () => {
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(duoSnapshot));
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(duoSnapshot));

    const first = displayRegionsNative.getSnapshot();
    const second = displayRegionsNative.getSnapshot();

    expect(second).toBe(first);
  });

  it.each<[string, string]>([
    ['malformed JSON', '{not json'],
    ['a non-object payload', '42'],
    ['a null payload', 'null'],
    ['an unknown size class', JSON.stringify({ ...duoSnapshot, horizontalSizeClass: 'huge' })],
    ['an unknown bar edge', JSON.stringify({ ...duoSnapshot, verticalBarEdge: 'top' })],
    ['a fold region missing a field', JSON.stringify({ ...duoSnapshot, foldRegion: { x: 1 } })],
    [
      'a fold region with a string field',
      JSON.stringify({ ...duoSnapshot, foldRegion: { x: '1', y: 0, width: 1, height: 1 } }),
    ],
    [
      'an absent fold region',
      JSON.stringify({ horizontalSizeClass: 'regular', verticalBarEdge: 'leading' }),
    ],
  ])('returns the fallback snapshot for %s', (_name, nativeJson) => {
    nativeModule.getSnapshot.mockReturnValueOnce(nativeJson);

    expect(displayRegionsNative.getSnapshot()).toBe(FALLBACK_SNAPSHOT);
  });

  it('models an older system as a compact, bar-less, unfolded window', () => {
    expect(FALLBACK_SNAPSHOT).toEqual({
      horizontalSizeClass: 'compact',
      verticalBarEdge: 'none',
      foldRegion: null,
    });
  });
});

describe('displayRegionsNative.subscribe', () => {
  it('delivers the parsed payload of each native onChange event', () => {
    const capture = captureEmitter();
    const listener = jest.fn();

    displayRegionsNative.subscribe(listener);
    capture.emit(JSON.stringify(duoSnapshot));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(duoSnapshot);
  });

  it('delivers the fallback snapshot for a malformed payload', () => {
    const capture = captureEmitter();
    const listener = jest.fn();

    displayRegionsNative.subscribe(listener);
    capture.emit('{not json');

    expect(listener).toHaveBeenCalledWith(FALLBACK_SNAPSHOT);
  });

  it('removes the native subscription when the returned function is called', () => {
    const remove = jest.fn();
    nativeModule.onChange.mockReturnValueOnce({ remove });

    const unsubscribe = displayRegionsNative.subscribe(jest.fn());

    expect(remove).not.toHaveBeenCalled();

    unsubscribe();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
