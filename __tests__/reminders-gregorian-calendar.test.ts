import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// Reminder triggers are Swift, and Swift is not mutated, so "a reminder fires
// on the day JS planned under any device calendar" is pinned here by code
// shape alone. UNCalendarNotificationTrigger reads the year/month/day it is
// given in the device calendar unless the components carry their own, so a
// Buddhist device (year 2569) turns Gregorian 2026 components into a date
// centuries off, or into none.
const remindersDirectory = join(__dirname, '../ios/Kiko/Reminders');

const swiftFiles = (): readonly string[] =>
  readdirSync(remindersDirectory).filter((name) => name.endsWith('.swift'));

const swiftSource = (name: string): string => readFileSync(join(remindersDirectory, name), 'utf8');

// Everything between the declaration's opening brace and the first line that
// is only the same indentation's closing brace.
const declarationBody = (source: string, signature: string): string => {
  const signatureIndex = source.indexOf(signature);

  if (signatureIndex < 0) {
    return '';
  }
  const start = source.lastIndexOf('\n', signatureIndex) + 1;
  const lines = source.slice(start).split('\n');
  const indentation = /^\s*/.exec(lines[0])?.[0] ?? '';
  const end = lines.findIndex((line, index) => index > 0 && line === `${indentation}}`);

  return lines.slice(1, end).join('\n');
};

describe('ios/Kiko/Reminders date and trigger builders use the Gregorian calendar', () => {
  it('finds the reminder Swift files', () => {
    expect(swiftFiles()).toEqual(
      expect.arrayContaining(['KikoRemindersCenter.swift', 'KikoNotificationDelegate.swift']),
    );
  });

  it.each(swiftFiles())('%s never reads the device calendar', (name) => {
    const source = swiftSource(name);

    expect(source).not.toMatch(/Calendar\.(current|autoupdatingCurrent)\b/);
    expect(source).not.toMatch(/\bNSCalendar\b/);
    expect(source).not.toMatch(/\bCalendar\(\)/);
  });

  it.each(swiftFiles())('%s makes a Calendar only from the Gregorian identifier', (name) => {
    const identifiers = [...swiftSource(name).matchAll(/\bCalendar\(identifier:\s*([^)]+)\)/g)].map(
      (match) => match[1],
    );

    expect(identifiers.every((identifier) => identifier === '.gregorian')).toBe(true);
  });

  it('builds the one Gregorian calendar whose zone follows the device zone', () => {
    const body = declarationBody(
      swiftSource('KikoRemindersCenter.swift'),
      'static var gregorian: Calendar',
    );

    expect(body).toContain('Calendar(identifier: .gregorian)');
    expect(body).toContain('TimeZone.autoupdatingCurrent');
  });

  it('gives the scheduled trigger components the Gregorian calendar', () => {
    const body = declarationBody(
      swiftSource('KikoRemindersCenter.swift'),
      'var floatingDateComponents: DateComponents',
    );

    expect(body).toMatch(/DateComponents\(\s*calendar:\s*\.gregorian/);
  });

  it('gives the snooze trigger components the Gregorian calendar', () => {
    const source = swiftSource('KikoNotificationDelegate.swift');
    const body = declarationBody(source, 'static func tomorrow(atTimeOf');

    expect(body).toContain('Calendar.gregorian');
    expect(body).toMatch(/return DateComponents\(\s*calendar:\s*calendar/);
  });

  it('sets no time zone on the components, so a reminder stays floating wall-clock time', () => {
    const scheduled = declarationBody(
      swiftSource('KikoRemindersCenter.swift'),
      'var floatingDateComponents: DateComponents',
    );
    const snooze = declarationBody(
      swiftSource('KikoNotificationDelegate.swift'),
      'static func tomorrow(atTimeOf',
    );

    expect(scheduled).not.toContain('timeZone:');
    expect(snooze).not.toMatch(/DateComponents\([^)]*timeZone:/);
  });
});
