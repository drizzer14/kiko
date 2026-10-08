// jest.config.js pins the suite to Europe/Kyiv so local-calendar and DST tests
// read the same clock on every host; a broken pin must fail here, not pass the
// DST cases on whatever zone the host happens to run.
describe('the Jest time zone pin', () => {
  it('runs on Kyiv winter time (UTC+2) in January', () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(-120);
  });

  it('runs on Kyiv summer time (UTC+3) in July', () => {
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(-180);
  });
});
