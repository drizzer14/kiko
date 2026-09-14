import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import DescriptionSuggestions from '.';

// A small pool of past MANUAL descriptions, newest-first (the query already
// orders them by recency, so the component preserves the given order).
const PAST = ['Coffee at Blue Bottle', 'Coffee beans', 'Groceries run', 'Gym membership'];

describe('DescriptionSuggestions', () => {
  it('renders the past descriptions that match the typed value', async () => {
    const { getByText, queryByText } = await render(
      <DescriptionSuggestions descriptions={PAST} value="cof" onPick={jest.fn()} />,
    );

    // Case-insensitive substring match via `normalizeTransactionName`.
    expect(getByText('Coffee at Blue Bottle')).toBeTruthy();
    expect(getByText('Coffee beans')).toBeTruthy();
    // A non-matching past description is not offered.
    expect(queryByText('Groceries run')).toBeNull();
  });

  it('fills the field via onPick with the verbatim description when a chip is tapped', async () => {
    const onPick = jest.fn();
    const { getByText } = await render(
      <DescriptionSuggestions descriptions={PAST} value="cof" onPick={onPick} />,
    );

    await fireEvent.press(getByText('Coffee beans'));

    expect(onPick).toHaveBeenCalledWith('Coffee beans');
  });

  it('renders nothing when no past description matches the typed value', async () => {
    const { toJSON } = await render(
      <DescriptionSuggestions descriptions={PAST} value="zzz" onPick={jest.fn()} />,
    );

    expect(toJSON()).toBeNull();
  });

  it('renders nothing while the field is empty', async () => {
    const { toJSON } = await render(
      <DescriptionSuggestions descriptions={PAST} value="" onPick={jest.fn()} />,
    );

    expect(toJSON()).toBeNull();
  });

  it('hides once the typed value exactly equals a suggestion (e.g. right after a tap)', async () => {
    const { toJSON } = await render(
      <DescriptionSuggestions descriptions={PAST} value="Coffee beans" onPick={jest.fn()} />,
    );

    expect(toJSON()).toBeNull();
  });

  it('caps the list at five and offers each distinct description once', async () => {
    const many = ['A one', 'A two', 'A three', 'A four', 'A five', 'A six', 'A two'];
    const { getAllByText, queryByText } = await render(
      <DescriptionSuggestions descriptions={many} value="a" onPick={jest.fn()} />,
    );

    // Six distinct names plus a duplicate: only the first five (newest-first)
    // are shown, so the sixth never appears...
    expect(queryByText('A six')).toBeNull();
    // ...and the duplicate is collapsed to a single chip.
    expect(getAllByText('A two')).toHaveLength(1);
  });
});
