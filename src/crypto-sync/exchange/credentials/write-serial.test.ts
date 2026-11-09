import { createWriteSerial } from './write-serial';

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';

// Lets every write already allowed to start run to its next wait.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// A write that starts at once and ends when the test says so.
const heldWrite = (log: string[], name: string) => {
  let end = (): void => undefined;
  let fail = (): void => undefined;
  const gate = new Promise<void>((resolve, reject) => {
    end = resolve;
    fail = () => reject(new Error('keychain write failed'));
  });
  const write = async (): Promise<string> => {
    log.push(`${name} started`);
    await gate;
    log.push(`${name} ended`);

    return name;
  };

  return { write, end, fail };
};

describe('createWriteSerial: the queue', () => {
  it('starts the second write for an account only after the first one ends', async () => {
    const { serialized } = createWriteSerial();
    const log: string[] = [];
    const first = heldWrite(log, 'first');
    const second = heldWrite(log, 'second');
    const firstResult = serialized(ACCOUNT_A, first.write);
    const secondResult = serialized(ACCOUNT_A, second.write);

    await settle();
    expect(log).toEqual(['first started']);

    first.end();
    await settle();
    expect(log).toEqual(['first started', 'first ended', 'second started']);

    second.end();
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual(['first', 'second']);
  });

  it('does not make one account wait for another', async () => {
    const { serialized } = createWriteSerial();
    const log: string[] = [];
    const slow = heldWrite(log, 'slow');
    const pending = serialized(ACCOUNT_A, slow.write);

    await expect(serialized(ACCOUNT_B, async () => 'quick')).resolves.toBe('quick');

    slow.end();
    await pending;
  });

  it('starts the next write after a failed one ends, and passes the failure to its caller', async () => {
    const { serialized } = createWriteSerial();
    const log: string[] = [];
    const failing = heldWrite(log, 'failing');
    const failed = expect(serialized(ACCOUNT_A, failing.write)).rejects.toThrow(
      'keychain write failed',
    );
    const next = serialized(ACCOUNT_A, async () => 'next');

    await settle();
    expect(log).toEqual(['failing started']);

    failing.fail();
    await failed;
    await expect(next).resolves.toBe('next');
  });

  it('keeps the queue of one instance apart from the queue of another', async () => {
    const log: string[] = [];
    const held = heldWrite(log, 'held');
    const pending = createWriteSerial().serialized(ACCOUNT_A, held.write);

    await expect(createWriteSerial().serialized(ACCOUNT_A, async () => 'other')).resolves.toBe(
      'other',
    );

    held.end();
    await pending;
  });
});

describe('createWriteSerial: the write tokens', () => {
  it('names the stored write: a token holds until a later write replaces it', () => {
    const { issueToken, holdsToken } = createWriteSerial();
    const first = issueToken(ACCOUNT_A);

    expect(holdsToken(ACCOUNT_A, first)).toBe(true);

    const second = issueToken(ACCOUNT_A);

    expect(second).not.toBe(first);
    expect(holdsToken(ACCOUNT_A, first)).toBe(false);
    expect(holdsToken(ACCOUNT_A, second)).toBe(true);
  });

  it('holds no token for an account that was never issued one', () => {
    const { issueToken, holdsToken } = createWriteSerial();

    expect(holdsToken(ACCOUNT_A, issueToken(ACCOUNT_B))).toBe(false);
  });

  it('drops the token with the pair', () => {
    const { issueToken, dropToken, holdsToken } = createWriteSerial();
    const token = issueToken(ACCOUNT_A);

    dropToken(ACCOUNT_A);

    expect(holdsToken(ACCOUNT_A, token)).toBe(false);
  });

  it('does not accept a token another instance issued', () => {
    const { holdsToken } = createWriteSerial();
    const { issueToken } = createWriteSerial();

    expect(holdsToken(ACCOUNT_A, issueToken(ACCOUNT_A))).toBe(false);
  });
});
