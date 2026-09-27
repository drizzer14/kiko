import { fireEvent, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import PropertyTypeField from './property-type-field.component';

type RenderedNode = {
  props: Record<string, unknown>;
  children: readonly (RenderedNode | string)[];
};

// Every SF Symbol name rendered anywhere under `node` — v14 of the testing
// library dropped the by-type queries, and a row's glyph carries no testID.
const glyphNamesWithin = (node: RenderedNode): string[] => [
  ...(typeof node.props.fallbackName === 'string' ? [String(node.props.name)] : []),
  ...node.children.flatMap((child) => (typeof child === 'string' ? [] : glyphNamesWithin(child))),
];

describe('PropertyTypeField', () => {
  it("shows the selected category's label in the trigger, labeled Type", async () => {
    const { getByText, getByTestId } = await render(
      <PropertyTypeField selected="real_estate" onSelect={jest.fn()} testID="property-type" />,
    );

    expect(getByText('Type')).toBeTruthy();
    expect(getByTestId('property-type')).toHaveTextContent('Real estate');
  });

  it('lists every property category, in the Real estate/Vehicle/Valuable/Business share/Loan given/Other order, and reports the tapped one', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getAllByTestId } = await render(
      <PropertyTypeField selected="real_estate" onSelect={onSelect} testID="property-type" />,
    );

    await fireEvent.press(getByTestId('property-type'));

    const rows = getAllByTestId(/^property-type-option-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'property-type-option-real_estate',
      'property-type-option-vehicle',
      'property-type-option-valuable',
      'property-type-option-business_share',
      'property-type-option-loan_given',
      'property-type-option-other',
    ]);

    await fireEvent.press(getByTestId('property-type-option-vehicle'));

    expect(onSelect).toHaveBeenCalledWith('vehicle');
  });

  it("shows each category's own glyph on its sheet row and the selected one on the trigger", async () => {
    const { getByTestId } = await render(
      <PropertyTypeField selected="vehicle" onSelect={jest.fn()} testID="property-type" />,
    );

    expect(glyphNamesWithin(getByTestId('property-type'))).toEqual(['car.fill']);

    await fireEvent.press(getByTestId('property-type'));

    expect(glyphNamesWithin(getByTestId('property-type-option-valuable'))).toContain(
      'diamond.fill',
    );
    expect(glyphNamesWithin(getByTestId('property-type-option-business_share'))).toContain(
      'briefcase.fill',
    );
  });
});
