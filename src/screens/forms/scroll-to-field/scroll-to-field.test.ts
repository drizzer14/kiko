import type { ScrollViewInstance } from 'react-native';
import { Keyboard } from 'react-native';

import {
  type FieldInstance,
  COMPACT_HEADER_HEIGHT,
  resolveFieldScrollTarget,
  resolveHeaderInset,
  scrollToField,
} from './scroll-to-field';

describe('resolveHeaderInset', () => {
  it('adds the fixed compact nav-bar height to the safe-area top inset', () => {
    expect(resolveHeaderInset(59)).toBe(59 + COMPACT_HEADER_HEIGHT);
  });

  it('floors at the compact height alone for a device with no top inset', () => {
    expect(resolveHeaderInset(0)).toBe(COMPACT_HEADER_HEIGHT);
  });
});

describe('resolveFieldScrollTarget', () => {
  const base = {
    currentOffset: 0,
    viewportHeight: 800,
    keyboardHeight: 0,
    headerInset: 100,
  };

  it('does not scroll when the field is already fully visible below the header and above the keyboard', () => {
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 200, fieldHeight: 50 });

    expect(decision).toEqual({ shouldScroll: false, targetOffset: 0 });
  });

  it('scrolls when the field sits under the header band, clamping the target to 0', () => {
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 50, fieldHeight: 50 });

    expect(decision).toEqual({ shouldScroll: true, targetOffset: 0 });
  });

  it('scrolls when the field is occluded by the keyboard at the bottom', () => {
    const decision = resolveFieldScrollTarget({
      ...base,
      fieldTop: 750,
      fieldHeight: 50,
      keyboardHeight: 300,
    });

    expect(decision).toEqual({ shouldScroll: true, targetOffset: 650 });
  });

  it('lands the field just below the collapsed header, not at content top', () => {
    const decision = resolveFieldScrollTarget({
      ...base,
      currentOffset: 400,
      fieldTop: 1200,
      fieldHeight: 50,
    });

    expect(decision).toEqual({ shouldScroll: true, targetOffset: 1100 });
  });

  it('clamps the landing target to 0 rather than a negative offset', () => {
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 10, fieldHeight: 20 });

    expect(decision.targetOffset).toBe(0);
  });
});

describe('scrollToField', () => {
  const geometry = { currentOffset: 0, headerInset: 60 };

  const mockScrollView = (viewportHeight: number, scrollTo = jest.fn()) => ({
    scrollTo,
    measure: jest.fn(
      (
        callback: (
          x: number,
          y: number,
          width: number,
          height: number,
          pageX: number,
          pageY: number,
        ) => void,
      ) => callback(0, 0, 375, viewportHeight, 0, 0),
    ),
  });

  const mockField = (fieldTop: number, fieldHeight: number) => ({
    measureLayout: jest.fn(
      (
        _relativeTo: unknown,
        onSuccess: (x: number, y: number, width: number, height: number) => void,
      ) => onSuccess(0, fieldTop, 300, fieldHeight),
    ),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scrolls to just below the header when the field is off-screen', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    const fieldRef = { current: mockField(1000, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);

    scrollToField(scrollableRef, fieldRef, geometry);

    expect(scrollTo).toHaveBeenCalledWith({ y: 940, animated: true });
  });

  it('does not scroll when the field is already fully visible', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    const fieldRef = { current: mockField(200, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);

    scrollToField(scrollableRef, fieldRef, geometry);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('subtracts the live keyboard height from the visible area', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    // Fully visible against the bare viewport, but occluded once a 300pt
    // keyboard is up.
    const fieldRef = { current: mockField(700, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue({
      screenX: 0,
      screenY: 500,
      width: 375,
      height: 300,
    });

    scrollToField(scrollableRef, fieldRef, geometry);

    expect(scrollTo).toHaveBeenCalledWith({ y: 640, animated: true });
  });

  it('calls onSettled once positioning resolves, whether or not it scrolled', () => {
    const scrollableRef = { current: mockScrollView(800) as unknown as ScrollViewInstance };
    const fieldRef = { current: mockField(200, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);
    const onSettled = jest.fn();

    scrollToField(scrollableRef, fieldRef, geometry, onSettled);

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the scroll view ref is not yet attached', () => {
    const fieldRef = { current: mockField(200, 50) as unknown as FieldInstance };
    const onSettled = jest.fn();

    expect(() => scrollToField({ current: null }, fieldRef, geometry, onSettled)).not.toThrow();
    expect(fieldRef.current?.measureLayout).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('no-ops when the field ref is not yet attached', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    const onSettled = jest.fn();

    expect(() =>
      scrollToField(scrollableRef, { current: null }, geometry, onSettled),
    ).not.toThrow();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('does not throw, and does not settle, when measureLayout reports failure', () => {
    const measureLayout = jest.fn((_relativeTo, _onSuccess, onFail: () => void) => onFail());
    const scrollableRef = { current: mockScrollView(800) as unknown as ScrollViewInstance };
    const fieldRef = { current: { measureLayout } as unknown as FieldInstance };
    const onSettled = jest.fn();

    expect(() => scrollToField(scrollableRef, fieldRef, geometry, onSettled)).not.toThrow();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
