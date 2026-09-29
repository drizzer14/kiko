import { logFailure } from './log-failure';

describe('logFailure', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('logs the tag with the error name only, never its message', () => {
    logFailure('[t]', new Error('Failed query: select * from transactions params: SECRET'));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[t]', { name: 'Error', code: undefined });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });

  it('keeps a subclass name', () => {
    logFailure('[t]', new TypeError('SECRET'));

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'TypeError', code: undefined });
  });

  it('logs a string code', () => {
    const error = Object.assign(new Error('SECRET'), { code: 'SQLITE_BUSY' });

    logFailure('[t]', error);

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'Error', code: 'SQLITE_BUSY' });
  });

  it('logs a number code', () => {
    logFailure('[t]', Object.assign(new Error('SECRET'), { code: 429 }));

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'Error', code: 429 });
  });

  it('drops a code that is neither a string nor a number', () => {
    logFailure('[t]', Object.assign(new Error('x'), { code: { detail: 'SECRET' } }));

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'Error', code: undefined });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });

  it('ignores an inherited code', () => {
    const error = Object.create({ code: 'SECRET' }) as unknown;

    logFailure('[t]', error);

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'object', code: undefined });
  });

  it('logs the type of a thrown string, never the string itself', () => {
    logFailure('[t]', 'boom SECRET');

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'string', code: undefined });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });

  it('logs undefined as its type', () => {
    logFailure('[t]', undefined);

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'undefined', code: undefined });
  });

  it('logs null as its type', () => {
    logFailure('[t]', null);

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'object', code: undefined });
  });

  it('never logs a nested cause', () => {
    logFailure('[t]', new Error('outer', { cause: new Error('SECRET') }));

    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });
});
