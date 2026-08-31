import { render } from '@testing-library/react-native';
import { Money } from '../../../currency/money';
import '../../unistyles';
import MoneyText from './money-text.component';

describe('MoneyText', () => {
  it('renders the formatted amount', async () => {
    const { getByText } = await render(<MoneyText money={Money.of('USD', 123456)} />);
    expect(getByText(/1,234\.56 USD/)).toBeTruthy();
  });
});
