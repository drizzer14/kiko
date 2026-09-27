import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';

import PreviewDetailList from './preview-detail-list.component';

describe('PreviewDetailList', () => {
  it('renders each item as its own text line', async () => {
    const { getByText } = await render(
      <PreviewDetailList items={['1111 **** **** 1111', 'UAH']} />,
    );

    expect(getByText('1111 **** **** 1111')).toBeTruthy();
    expect(getByText('UAH')).toBeTruthy();
  });

  it('renders an optional label above the items', async () => {
    const { getByText } = await render(
      <PreviewDetailList items={['UAH', 'USD']} label="Currencies in this file" />,
    );

    expect(getByText('Currencies in this file')).toBeTruthy();
  });

  it('renders no label when none is given', async () => {
    const { queryByText } = await render(<PreviewDetailList items={['UAH']} />);

    expect(queryByText('Currencies in this file')).toBeNull();
  });

  it('forwards testID onto the wrapping container', async () => {
    const { getByTestId } = await render(
      <PreviewDetailList items={['UAH']} testID="preview-detail-list" />,
    );

    expect(getByTestId('preview-detail-list')).toBeTruthy();
  });
});
