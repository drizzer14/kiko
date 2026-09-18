import type { ScrollViewInstance } from 'react-native';

import { type FieldInstance, scrollToField } from './scroll-to-field';

describe('scrollToField', () => {
  it('measures the field relative to the scroll view and scrolls to its offset, minus the top padding', () => {
    const scrollTo = jest.fn();
    const measureLayout = jest.fn((_relativeTo, onSuccess: (x: number, y: number) => void) => {
      onSuccess(0, 300);
    });
    const scrollableRef = { current: { scrollTo } as unknown as ScrollViewInstance };
    const fieldRef = { current: { measureLayout } as unknown as FieldInstance };

    scrollToField(scrollableRef, fieldRef);

    expect(measureLayout).toHaveBeenCalledWith(
      scrollableRef.current,
      expect.any(Function),
      expect.any(Function),
    );
    expect(scrollTo).toHaveBeenCalledWith({ y: 284, animated: true });
  });

  it('clamps to 0 rather than scrolling to a negative offset', () => {
    const scrollTo = jest.fn();
    const measureLayout = jest.fn((_relativeTo, onSuccess: (x: number, y: number) => void) => {
      onSuccess(0, 5);
    });
    const scrollableRef = { current: { scrollTo } as unknown as ScrollViewInstance };
    const fieldRef = { current: { measureLayout } as unknown as FieldInstance };

    scrollToField(scrollableRef, fieldRef);

    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('no-ops when the scroll view ref is not yet attached', () => {
    const fieldRef = { current: { measureLayout: jest.fn() } as unknown as FieldInstance };

    expect(() => scrollToField({ current: null }, fieldRef)).not.toThrow();
    expect(fieldRef.current?.measureLayout).not.toHaveBeenCalled();
  });

  it('no-ops when the field ref is not yet attached', () => {
    const scrollTo = jest.fn();
    const scrollableRef = { current: { scrollTo } as unknown as ScrollViewInstance };

    expect(() => scrollToField(scrollableRef, { current: null })).not.toThrow();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not throw when measureLayout reports failure', () => {
    const measureLayout = jest.fn((_relativeTo, _onSuccess, onFail: () => void) => onFail());
    const scrollableRef = { current: { scrollTo: jest.fn() } as unknown as ScrollViewInstance };
    const fieldRef = { current: { measureLayout } as unknown as FieldInstance };

    expect(() => scrollToField(scrollableRef, fieldRef)).not.toThrow();
  });
});
