import { act, fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import '../../../i18n';
import type { TrendFilter } from '../../../statistics/trend-filter';

import TrendFilterField from './trend-filter-field.component';

// The jest unistyles mock strips every resolved fill color from a rendered
// node's style (both `textPrimary` and `textSecondary` flatten to `{}`), so the
// section-header tone cannot be asserted from the resolved hex. Mock the shared
// `Text` primitive with a passthrough that forwards its `tone` prop onto the
// host node instead, so the test can read the PROP that drives the color.
jest.mock('../../../design-system/components/text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');

  const MockText = ({ children, tone }: { children: React.ReactNode; tone?: string }) => {
    return React.createElement(RNText, { tone }, children);
  };

  return { __esModule: true, default: MockText };
});

const FIELD_ID = 'trend-filter';

const openSheet = async (filter: TrendFilter): ReturnType<typeof render> => {
  const utilities = await render(
    <TrendFilterField
      testID={FIELD_ID}
      filter={filter}
      categoryOptions={[{ value: 'groceries', label: 'Groceries' }]}
      onSave={() => {}}
    />,
  );

  await act(async () => {
    fireEvent.press(utilities.getByTestId(FIELD_ID));
  });

  return utilities;
};

describe('TrendFilterField section header tone', () => {
  it('gives the top-mode section headers the white textPrimary tone', async () => {
    const { getByText } = await openSheet({ mode: 'top', amount: 3, by: 'contribution' });

    // The section headers read as strong white sub-headings, not the dim grey
    // (`textSecondary`) they were before, so the grouped hierarchy is legible.
    expect(getByText('Selection').props.tone).toBe('textPrimary');
    expect(getByText('Amount').props.tone).toBe('textPrimary');
    expect(getByText('By').props.tone).toBe('textPrimary');
  });

  it('gives the manual-mode categories header the white textPrimary tone', async () => {
    const { getByText } = await openSheet({ mode: 'manual', keys: [] });

    expect(getByText('Categories').props.tone).toBe('textPrimary');
  });
});
