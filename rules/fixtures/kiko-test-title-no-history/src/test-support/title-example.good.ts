// Semgrep fixture (NEGATIVE, NESTED): every title below states what the test pins. None opens with
// a task id or a ruling id, and none carries an old-value label in parentheses, so
// `kiko-test-title-no-history` must draw ZERO findings from this file.

describe('the footer', () => {
  it('keeps the row flat', () => {});

  test('renders the empty state', () => {});

  // A letter and digits that do not open the title are data, not an id.
  it('reads the A1 cell of the sheet', () => {});

  // A capital letter, then digits, with no space after: a name, not an id.
  it('B12px stays a unit', () => {});

  // A word that starts a sentence, and a version label, are not ids.
  it('Holds the cap at 30', () => {});

  it('v2 import reads the header', () => {});

  // The word ruling with no id after it.
  it('ruling on amounts rounds half up', () => {});

  // `was` with no colon, and a colon with no `was`.
  it('keeps what was stored', () => {});

  it('rows (kind: card) stay flat', () => {});

  it.each([1, 2])('runs a table row for %s', () => {});

  it.only('runs a focused test', () => {});
});

describe.each([1, 2])('suite for %s', () => {});

// A title that is not a string literal is out of the rule's reach.
const title = 'A1 not a literal call';
it(title, () => {});
