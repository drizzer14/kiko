import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// Reminder triggers are Swift, and Swift is not mutated, so "a reminder fires
// on the day JS planned, at the same wall-clock time, under any device
// calendar" is pinned here by code shape alone. UNCalendarNotificationTrigger
// reads the components it is given in the device calendar, so a Buddhist
// device (year 2569) turns Gregorian 2026 components into a date centuries
// off. A Calendar on the components cannot fix that: a Calendar always carries
// a time zone, and the trigger is archived to the notification daemon, so the
// reminder would stop floating with the device zone. The date is therefore
// computed Gregorian, then handed over as plain device-calendar components.
const remindersDirectory = join(__dirname, '../ios/Kiko/Reminders');

const swiftFiles = (): readonly string[] =>
  readdirSync(remindersDirectory).filter((name) => name.endsWith('.swift'));

const swiftSource = (name: string): string => readFileSync(join(remindersDirectory, name), 'utf8');

const withoutComments = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

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

  return withoutComments(lines.slice(1, end).join('\n'));
};

const floatingBody = (): string =>
  declarationBody(
    swiftSource('KikoRemindersCenter.swift'),
    'var floatingDateComponents: DateComponents',
  );

const triggerArguments = (): readonly string[] =>
  swiftFiles().flatMap((name) =>
    [
      ...withoutComments(swiftSource(name)).matchAll(
        /UNCalendarNotificationTrigger\(\s*dateMatching:\s*([^,)]+(?:\([^)]*\))?[^,)]*)/g,
      ),
    ].map((match) => match[1].trim()),
  );

describe('ios/Kiko/Reminders trigger components are floating, in the device calendar', () => {
  it('finds the reminder Swift files', () => {
    expect(swiftFiles()).toEqual(
      expect.arrayContaining(['KikoRemindersCenter.swift', 'KikoNotificationDelegate.swift']),
    );
  });

  it('reads the device calendar only inside the one trigger builder', () => {
    const readers = swiftFiles().flatMap((name) => [
      ...(withoutComments(swiftSource(name)).match(/Calendar\.(current|autoupdatingCurrent)\b/g) ??
        []),
    ]);

    expect(readers).toHaveLength(1);
    expect(floatingBody()).toContain('Calendar.current');
  });

  it.each(swiftFiles())('%s never uses NSCalendar or a bare Calendar()', (name) => {
    const source = withoutComments(swiftSource(name));

    expect(source).not.toMatch(/\bNSCalendar\b/);
    expect(source).not.toMatch(/\bCalendar\(\)/);
  });

  it.each(swiftFiles())('%s makes a Calendar only from the Gregorian identifier', (name) => {
    const identifiers = [
      ...withoutComments(swiftSource(name)).matchAll(/\bCalendar\(identifier:\s*([^)]+)\)/g),
    ].map((match) => match[1]);

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

  it('converts only the day of a Gregorian-built date, era included', () => {
    const body = floatingBody();
    const gregorianDate = body.indexOf('Calendar.gregorian');
    const dateBuilt = body.indexOf('.date(from:');
    const conversion = body.indexOf(
      'Calendar.current.dateComponents([.era, .year, .month, .day], from:',
    );

    expect(gregorianDate).toBeGreaterThanOrEqual(0);
    expect(dateBuilt).toBeGreaterThan(gregorianDate);
    expect(conversion).toBeGreaterThan(dateBuilt);
  });

  // The day converts at noon and the hour and minute pass through, because a
  // DST gap (a 03:30 that does not exist) would otherwise be shifted to 04:30
  // by the lenient Date build, away from the stamp JS gave the request.
  it('converts the day at noon and passes the planned hour and minute through unchanged', () => {
    const body = floatingBody();

    expect(body).toMatch(/hour:\s*12\b/);
    expect(body).toMatch(/\.hour = hour\b/);
    expect(body).toMatch(/\.minute = minute\b/);
    expect(body).not.toContain('.hour, .minute]');
  });

  it('sets no calendar and no time zone on any components, so a reminder stays floating', () => {
    // The Gregorian calendar's own zone is the one legitimate `.timeZone =`.
    const gregorianCalendar = declarationBody(
      swiftSource('KikoRemindersCenter.swift'),
      'static var gregorian: Calendar',
    );

    for (const name of swiftFiles()) {
      const source = withoutComments(swiftSource(name)).replace(gregorianCalendar, '');

      expect(source).not.toMatch(/\bcalendar:\s*[.\w]/);
      expect(source).not.toMatch(/\btimeZone:\s*[.\w]/);
      expect(source).not.toMatch(/\.(calendar|timeZone)\s*=\s*[.\w]/);
    }
  });

  it('hands every trigger the output of the one builder, so no third site slips by', () => {
    const triggerArgumentsFound = triggerArguments();

    expect(triggerArgumentsFound.length).toBeGreaterThanOrEqual(2);
    expect(
      triggerArgumentsFound.every((argument) => /^[\w.]+\.floatingDateComponents$/.test(argument)),
    ).toBe(true);
  });

  it('keeps the snooze day and stamp Gregorian, the same as the JS fireStamp', () => {
    const source = swiftSource('KikoNotificationDelegate.swift');
    const tomorrow = declarationBody(source, 'static func tomorrow(atTimeOf');

    expect(tomorrow).toContain('Calendar.gregorian');
    expect(tomorrow).toContain('LocalDateTime(');
    expect(source).toMatch(
      /requestsReplacedBySnooze\(of reminderId: String, at fireAt: LocalDateTime\)/,
    );
  });
});
