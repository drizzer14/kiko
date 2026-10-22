import { IdCursorPageError } from './id-cursor-pager';

describe('IdCursorPageError', () => {
  it.each(['not-safe-integer', 'not-ascending', 'over-limit', 'stop-out-of-page'] as const)(
    'names itself and carries the %s code in its message',
    (code) => {
      const error = new IdCursorPageError(code);

      expect(error.name).toBe('IdCursorPageError');
      expect(error.message).toBe(`id-cursor-page: ${code}`);
      expect(error.code).toBe(code);
      expect(error).toBeInstanceOf(IdCursorPageError);
      expect(error).toBeInstanceOf(Error);
    },
  );
});
