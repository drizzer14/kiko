import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { DisplayRegionsSnapshot } from '.';

type DisplayRegionsNativeModule = typeof import('.');

const duoSnapshot: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'regular',
  verticalBarEdge: 'trailing',
  foldRegion: { x: 470, y: 0, width: 11, height: 669 },
};

const flatSnapshot: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'compact',
  verticalBarEdge: 'none',
  foldRegion: null,
};

// The wrapper keeps the last native snapshot in module state, so each test loads its own copy of
// the wrapper together with the native mock that copy reads: a reset registry re-runs both module
// factories, and the wrapper requires the native module lazily from that same registry. The mock
// is read through the registry, not a value import: only the wrapper may load the native module.
let displayRegionsNative: DisplayRegionsNativeModule['displayRegionsNative'];
let FALLBACK_SNAPSHOT: DisplayRegionsNativeModule['FALLBACK_SNAPSHOT'];
let nativeModule: jest.Mocked<Spec>;

beforeEach(() => {
  jest.resetModules();
  ({ displayRegionsNative, FALLBACK_SNAPSHOT } = require('.') as DisplayRegionsNativeModule);
  nativeModule = (
    jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: jest.Mocked<Spec> }
  ).default;
});

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
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(flatSnapshot));

    expect(displayRegionsNative.getSnapshot()).toEqual(flatSnapshot);
  });

  it('reads the native module once, then hands back the cached object', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(duoSnapshot));

    const first = displayRegionsNative.getSnapshot();
    const second = displayRegionsNative.getSnapshot();
    const third = displayRegionsNative.getSnapshot();

    expect(nativeModule.getSnapshot).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
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
    expect(FALLBACK_SNAPSHOT).toEqual(flatSnapshot);
  });
});

describe('displayRegionsNative.subscribe', () => {
  it('delivers the parsed payload of each native onChange event', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(flatSnapshot));
    const capture = captureEmitter();
    const listener = jest.fn();

    displayRegionsNative.subscribe(listener);
    capture.emit(JSON.stringify(duoSnapshot));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(duoSnapshot);
  });

  it('keeps the cached snapshot current from the event payload, with no native read', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(flatSnapshot));
    const capture = captureEmitter();

    displayRegionsNative.getSnapshot();
    displayRegionsNative.subscribe(jest.fn());
    nativeModule.getSnapshot.mockClear();
    capture.emit(JSON.stringify(duoSnapshot));

    expect(displayRegionsNative.getSnapshot()).toEqual(duoSnapshot);
    expect(nativeModule.getSnapshot).not.toHaveBeenCalled();
  });

  it('delivers the fallback snapshot for a malformed payload', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(flatSnapshot));
    const capture = captureEmitter();
    const listener = jest.fn();

    displayRegionsNative.subscribe(listener);
    capture.emit('{not json');

    expect(listener).toHaveBeenCalledWith(FALLBACK_SNAPSHOT);
  });

  it('re-reads the native module once on subscribe and notifies a change since the first read', () => {
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(flatSnapshot));
    displayRegionsNative.getSnapshot();
    nativeModule.getSnapshot.mockReturnValueOnce(JSON.stringify(duoSnapshot));
    const listener = jest.fn();

    displayRegionsNative.subscribe(listener);

    expect(nativeModule.getSnapshot).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(duoSnapshot);
    expect(displayRegionsNative.getSnapshot()).toEqual(duoSnapshot);
  });

  it('stays quiet when the subscribe re-read finds nothing new', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(duoSnapshot));
    displayRegionsNative.getSnapshot();
    const listener = jest.fn();

    displayRegionsNative.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('re-reads only for the first subscriber, since the cache is then kept current', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(duoSnapshot));
    displayRegionsNative.getSnapshot();

    displayRegionsNative.subscribe(jest.fn());
    displayRegionsNative.subscribe(jest.fn());

    expect(nativeModule.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('drops the cache with the last subscriber, since nothing keeps it current any more', () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(flatSnapshot));
    const unsubscribeFirst = displayRegionsNative.subscribe(jest.fn());
    const unsubscribeSecond = displayRegionsNative.subscribe(jest.fn());
    displayRegionsNative.getSnapshot();
    nativeModule.getSnapshot.mockClear();

    unsubscribeFirst();
    displayRegionsNative.getSnapshot();

    expect(nativeModule.getSnapshot).not.toHaveBeenCalled();

    unsubscribeSecond();
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(duoSnapshot));

    expect(displayRegionsNative.getSnapshot()).toEqual(duoSnapshot);
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
