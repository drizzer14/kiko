import { act, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import type { ImportBalancePreview } from '@kiko/transactions/repo';

import ImportBalanceLine from './import-balance-line.component';

const AS_OF_SECONDS = 1_751_364_900;

const renderLine = (preview: ImportBalancePreview) =>
  render(<ImportBalanceLine preview={preview} testID="balance-line" />);

describe('ImportBalanceLine', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('says the balance will be set to the closing figure', async () => {
    const { getByTestId } = await renderLine({
      kind: 'set',
      currency: 'UAH',
      minorUnits: 85_000,
      bankMinorUnits: 85_000,
      asOfSeconds: AS_OF_SECONDS,
    });

    expect(getByTestId('balance-line')).toHaveTextContent('Balance will be set to 850.00 ₴');
  });

  it('adds the bank figure and its date when entries not in the statement make the result differ', async () => {
    const { getByTestId } = await renderLine({
      kind: 'set',
      currency: 'UAH',
      minorUnits: 85_000,
      bankMinorUnits: 90_000,
      asOfSeconds: AS_OF_SECONDS,
    });

    expect(getByTestId('balance-line')).toHaveTextContent(
      `Balance will be set to 850.00 ₴ (bank balance 900.00 ₴ on ${formatDate(AS_OF_SECONDS * 1000)}, plus entries not in this statement)`,
    );
  });

  it('formats a negative closing balance with the shared money formatter, no sign flip', async () => {
    const { getByTestId } = await renderLine({
      kind: 'set',
      currency: 'UAH',
      minorUnits: -120_050,
      bankMinorUnits: -120_050,
      asOfSeconds: AS_OF_SECONDS,
    });

    expect(getByTestId('balance-line')).toHaveTextContent('Balance will be set to -1,200.50 ₴');
  });

  it('says the balance will change from one figure to another', async () => {
    const { getByTestId } = await renderLine({
      kind: 'change',
      currency: 'UAH',
      fromMinorUnits: 100_000,
      toMinorUnits: 97_000,
    });

    expect(getByTestId('balance-line')).toHaveTextContent(
      'Balance will change from 1,000.00 ₴ to 970.00 ₴',
    );
  });

  it('says the balance stays when nothing moves it', async () => {
    const { getByTestId } = await renderLine({
      kind: 'stays',
      currency: 'UAH',
      minorUnits: 100_000,
    });

    expect(getByTestId('balance-line')).toHaveTextContent('Balance stays at 1,000.00 ₴');
  });

  it('reads in Ukrainian with the amounts grouped the Ukrainian way', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByTestId } = await renderLine({
      kind: 'change',
      currency: 'UAH',
      fromMinorUnits: 0,
      toMinorUnits: 85_000,
    });

    expect(getByTestId('balance-line')).toHaveTextContent(/^Баланс зміниться з .+ на .+$/);
  });

  it('reads the entries not in the statement in Ukrainian', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByTestId } = await renderLine({
      kind: 'set',
      currency: 'UAH',
      minorUnits: 85_000,
      bankMinorUnits: 90_000,
      asOfSeconds: AS_OF_SECONDS,
    });

    expect(getByTestId('balance-line')).toHaveTextContent(
      /^Баланс буде встановлено: .+ \(баланс у банку .+ на .+, плюс записи, яких немає у виписці\)$/,
    );
  });

  it('reads the unchanged balance in Ukrainian', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByTestId } = await renderLine({
      kind: 'stays',
      currency: 'UAH',
      minorUnits: 100_000,
    });

    expect(getByTestId('balance-line')).toHaveTextContent(/^Баланс не зміниться: .+$/);
  });
});
