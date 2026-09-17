import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import AddBankProviderSheet, { shouldShowUnreadyBanks, visibleCatalogEntries } from '.';

// Item E (whole-branch review, release readiness gating): `react-native-dotenv`
// inlines `@env` at BUILD time and deletes the import, so a `jest.mock('@env')`
// never runs (see `shouldShowUnreadyBanks`'s own doc comment) — these two pure
// functions are the hermetically testable seam for both flag states, mirroring
// `src/screenshot/screenshot-mode.test.ts`'s `parseScreenshotMode` pattern.
describe('shouldShowUnreadyBanks', () => {
  it('is true only for the exact string "true"', () => {
    expect(shouldShowUnreadyBanks('true')).toBe(true);
  });

  it('is false for any other value, including "false", "1", and empty', () => {
    expect(shouldShowUnreadyBanks('false')).toBe(false);
    expect(shouldShowUnreadyBanks('1')).toBe(false);
    expect(shouldShowUnreadyBanks('TRUE')).toBe(false);
    expect(shouldShowUnreadyBanks('')).toBe(false);
  });
});

describe('visibleCatalogEntries', () => {
  it('with the flag off, lists only the release-connect-ready providers (Monobank, Starling)', () => {
    expect(visibleCatalogEntries(false).map((entry) => entry.id)).toEqual(['monobank', 'starling']);
  });

  it('with the flag on, lists every wired provider regardless of connectReady', () => {
    expect(visibleCatalogEntries(true).map((entry) => entry.id)).toEqual([
      'monobank',
      'privatbank',
      'bunq',
      'starling',
    ]);
  });
});

describe('AddBankProviderSheet', () => {
  // The committed `.env.test` (the default ENVFILE for Jest, set in
  // jest.config.js) sets `SHOW_UNREADY_BANKS=true` (a test build, never a
  // release one — see `.env.example`'s comment), so the real,
  // build-time-inlined flag shows every wired entry here.
  it('renders the wired catalog entries with their about + eligibility copy', async () => {
    const view = await render(
      <AddBankProviderSheet visible onDismiss={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(view.getByText('Monobank')).toBeTruthy();
    expect(view.getByText('PrivatBank')).toBeTruthy();
    expect(view.getByText('bunq')).toBeTruthy();
    expect(view.getByText('Starling')).toBeTruthy();
    expect(view.getByText(/Works with any personal Monobank account/)).toBeTruthy();
    expect(view.getByText(/Requires a Privat24 business or individual-entrepreneur/)).toBeTruthy();
    expect(view.getByText(/bunq is a European mobile bank/)).toBeTruthy();
    expect(view.getByText(/Starling is a UK digital bank/)).toBeTruthy();
  });

  it('reports the chosen provider and closes the sheet on selection', async () => {
    const onSelect = jest.fn();
    const onDismiss = jest.fn();
    const view = await render(
      <AddBankProviderSheet visible onDismiss={onDismiss} onSelect={onSelect} />,
    );

    await fireEvent.press(view.getByTestId('add-bank-option-privatbank'));

    expect(onSelect).toHaveBeenCalledWith('privatbank');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', async () => {
    const view = await render(
      <AddBankProviderSheet visible={false} onDismiss={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(view.queryByText('Monobank')).toBeNull();
  });
});
