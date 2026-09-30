import type { HoldingType } from '@kiko/holdings/holding-type';
import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import MetalTypeField from './metal-type-field.component';

const typeLabels = {
  card: 'Card',
  term_deposit: 'Deposit',
  bond: 'Bond',
  cash: 'Cash',
  crypto_asset: 'Crypto asset',
  jar: 'Jar',
  property_item: 'Property',
  metal: 'Precious metal',
  loan: 'Loan',
  share: 'Share',
} satisfies Record<HoldingType, string>;

const setup = async (
  overrides: Partial<Parameters<typeof MetalTypeField>[0]> = {},
): Promise<{
  onSelectType: jest.Mock;
  onSelectMetal: jest.Mock;
  screen: Awaited<ReturnType<typeof render>>;
}> => {
  const onSelectType = jest.fn();
  const onSelectMetal = jest.fn();

  const screen = await render(
    <MetalTypeField
      otherTypes={[]}
      typeLabels={typeLabels}
      type="metal"
      metal="XAU"
      onSelectType={onSelectType}
      onSelectMetal={onSelectMetal}
      testID="metal-type"
      {...overrides}
    />,
  );

  return { onSelectType, onSelectMetal, screen };
};

const optionIds = (screen: Awaited<ReturnType<typeof render>>): string[] =>
  screen.getAllByTestId(/^metal-type-option-/).map((row) => String(row.props.testID));

describe('MetalTypeField', () => {
  it('lists the four metals under the Type label, showing the selected metal', async () => {
    const { screen } = await setup({ metal: 'XAG' });

    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByTestId('metal-type')).toHaveTextContent('Silver');

    await fireEvent.press(screen.getByTestId('metal-type'));

    expect(optionIds(screen)).toEqual([
      'metal-type-option-XAU',
      'metal-type-option-XAG',
      'metal-type-option-XPT',
      'metal-type-option-XPD',
    ]);
  });

  it('lists the other types first, then the four metals, with no generic metal row', async () => {
    const { screen } = await setup({ otherTypes: ['term_deposit', 'bond'], type: 'term_deposit' });

    expect(screen.getByTestId('metal-type')).toHaveTextContent('Deposit');

    await fireEvent.press(screen.getByTestId('metal-type'));

    expect(optionIds(screen)).toEqual([
      'metal-type-option-term_deposit',
      'metal-type-option-bond',
      'metal-type-option-XAU',
      'metal-type-option-XAG',
      'metal-type-option-XPT',
      'metal-type-option-XPD',
    ]);
  });

  it('reports a picked metal as the metal type plus that metal', async () => {
    const { screen, onSelectType, onSelectMetal } = await setup({
      otherTypes: ['term_deposit'],
      type: 'term_deposit',
    });

    await fireEvent.press(screen.getByTestId('metal-type'));
    await fireEvent.press(screen.getByTestId('metal-type-option-XPD'));

    expect(onSelectType).toHaveBeenCalledWith('metal');
    expect(onSelectMetal).toHaveBeenCalledWith('XPD');
  });

  it('reports a picked other type alone, leaving the metal untouched', async () => {
    const { screen, onSelectType, onSelectMetal } = await setup({ otherTypes: ['bond'] });

    await fireEvent.press(screen.getByTestId('metal-type'));
    await fireEvent.press(screen.getByTestId('metal-type-option-bond'));

    expect(onSelectType).toHaveBeenCalledWith('bond');
    expect(onSelectMetal).not.toHaveBeenCalled();
  });
});
