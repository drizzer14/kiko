import { withDeviceZoneOffset } from './device-zone-offset';

describe('withDeviceZoneOffset', () => {
  it('reads a local-time constructor call at the given fixed offset', () => {
    const milliseconds = withDeviceZoneOffset(-5, () => new Date(2026, 6, 15, 14, 30, 0).getTime());

    expect(milliseconds).toBe(Date.UTC(2026, 6, 15, 19, 30, 0));
  });

  it('keeps an instant built from milliseconds unchanged', () => {
    const instant = Date.UTC(2026, 8, 15, 11, 30, 0);

    expect(withDeviceZoneOffset(1, () => new Date(instant).getTime())).toBe(instant);
  });

  // Jest does not typecheck, so only the @ts-expect-error below proves the
  // refusal: check:typecheck fails once an async callback stops being a type
  // error. This body proves only that Date is restored.
  it('refuses a promise callback at type level (proven by check:typecheck), and restores Date', () => {
    const realDate = Date;

    // @ts-expect-error — an async `run` would read its awaited half in the real zone
    withDeviceZoneOffset(1, async () => new Date(2026, 6, 15).getTime()).catch(() => undefined);

    expect(Date).toBe(realDate);
  });

  it('restores the real Date afterward, even when the callback throws', () => {
    const realDate = Date;

    expect(() =>
      withDeviceZoneOffset(1, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(Date).toBe(realDate);
    expect(new Date(2026, 6, 15, 14, 30, 0).getTime()).toBe(Date.UTC(2026, 6, 15, 11, 30, 0));
  });
});
