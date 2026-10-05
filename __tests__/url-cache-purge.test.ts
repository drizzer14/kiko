import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// The one-time purge of the stored NSURLCache is Swift (SEC-C3), and Swift is
// not mutated, so "runs exactly once" is proven here by code shape alone: the
// once-key is read and returned on before the purge, and written only after
// the purge returned, so a launch killed mid-purge retries on the next one.
const swiftSource = (): string =>
  readFileSync(join(__dirname, '../ios/Kiko/AppDelegate.swift'), 'utf8');

// Everything between the function's opening brace and the first line that is
// only the same indentation's closing brace.
const functionBody = (source: string, signature: string): string => {
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

describe('ios/Kiko/AppDelegate.swift one-time URL cache purge', () => {
  const purgeBody = (): string => functionBody(swiftSource(), 'func purgeStoredURLCacheOnce()');

  it('purges the shared URL cache through removeAllCachedResponses', () => {
    expect(purgeBody()).toContain('URLCache.shared.removeAllCachedResponses()');
  });

  it('returns before the purge when the once-key is already set (the second launch does not purge)', () => {
    const body = purgeBody();
    const guardIndex = body.search(/guard\s+!\s*\w+\.bool\(forKey:/);

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(body.indexOf('removeAllCachedResponses'));
    expect(body.slice(guardIndex)).toMatch(/else\s*\{\s*return\s*\}/);
  });

  it('sets the once-key only AFTER the purge, so an interrupted purge is retried on the next launch', () => {
    const body = purgeBody();

    expect(body.indexOf('.set(true, forKey:')).toBeGreaterThan(
      body.indexOf('removeAllCachedResponses'),
    );
  });

  it('reads and writes the same once-key', () => {
    const body = purgeBody();
    const readKey = /\.bool\(forKey:\s*([^)]+)\)/.exec(body)?.[1];
    const writtenKey = /\.set\(true, forKey:\s*([^)]+)\)/.exec(body)?.[1];

    expect(readKey).toBeDefined();
    expect(writtenKey).toBe(readKey);
  });

  it('runs at launch, from application(_:didFinishLaunchingWithOptions:), before React Native starts', () => {
    const launchBody = functionBody(swiftSource(), 'func application(');

    expect(launchBody).toContain('purgeStoredURLCacheOnce()');
  });
});
