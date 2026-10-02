import { logOnFailure } from './log-on-failure';

describe('logOnFailure', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('resolves true and logs nothing when the task resolves', async () => {
    const task = jest.fn().mockResolvedValue('done');

    await expect(logOnFailure('[t]', task)).resolves.toBe(true);

    expect(task).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves false and logs the tag with the error name only when the task rejects', async () => {
    const task = jest.fn().mockRejectedValue(new Error('Failed query: SECRET'));

    await expect(logOnFailure('[t]', task)).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[t]', { name: 'Error', code: undefined });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
  });

  it('resolves false when the task throws before it returns a promise', async () => {
    const task = (): Promise<unknown> => {
      throw new TypeError('SECRET');
    };

    await expect(logOnFailure('[t]', task)).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith('[t]', { name: 'TypeError', code: undefined });
  });
});
