import { withDeviceZoneOffset } from './device-zone-offset';

describe('withDeviceZoneOffset', () => {
  it('reads a local-time constructor call at the given fixed offset', () => {
    const milliseconds = withDeviceZoneOffset(-5, () => new Date(2026, 6, 15, 14, 30, 0).getTime());

    expect(milliseconds).toBe(Date.UTC(2026, 6, 15, 19, 30, 0));
  });

  it('reads the local getters at the given fixed offset', () => {
    const instant = Date.UTC(2026, 0, 31, 23, 30, 0);

    const parts = withDeviceZoneOffset(1, () => {
      const date = new Date(instant);

      return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getDay()];
    });

    expect(parts).toEqual([2026, 1, 1, 0, 0]);
  });

  it('reports the offset through getTimezoneOffset, in minutes west of UTC', () => {
    expect(withDeviceZoneOffset(1, () => new Date().getTimezoneOffset())).toBe(-60);
  });

  it('keeps an instant built from milliseconds unchanged', () => {
    const instant = Date.UTC(2026, 8, 15, 11, 30, 0);

    expect(withDeviceZoneOffset(1, () => new Date(instant).getTime())).toBe(instant);
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
