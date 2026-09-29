// Semgrep fixture (NEGATIVE, NESTED): reading `process.env.TZ` is fine, and a
// test that needs another zone passes the offset into the code under test.
export const currentTimeZone = (): string | undefined => process.env.TZ;

export const localHourAt = (epochMilliseconds: number, offsetMinutes: number): number =>
  new Date(epochMilliseconds + offsetMinutes * 60_000).getUTCHours();
