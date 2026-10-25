import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { act } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';

import { paymentSplitText } from './payment-split-text';

const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));

describe('paymentSplitText', () => {
  it('reads the principal and the interest of a payment', () => {
    expect(paymentSplitText(i18n.t, 'UAH', 100_000, 2_550)).toBe(
      `Principal ${money(100_000)} · interest ${money(2_550)}`,
    );
  });

  it('reads only the principal when the interest is 0', () => {
    const text = paymentSplitText(i18n.t, 'UAH', 100_000, 0);

    expect(text).toBe(`Principal ${money(100_000)}`);
    expect(text).not.toContain('interest');
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('reads the principal and the interest from the Ukrainian catalogue', () => {
      expect(paymentSplitText(i18n.t, 'UAH', 100_000, 2_550)).toMatch(
        /^Основна сума .* · відсотки /,
      );
    });

    it('reads only the principal when the interest is 0', () => {
      const text = paymentSplitText(i18n.t, 'UAH', 100_000, 0);

      expect(text).toMatch(/^Основна сума /);
      expect(text).not.toContain('відсотки');
    });
  });
});
