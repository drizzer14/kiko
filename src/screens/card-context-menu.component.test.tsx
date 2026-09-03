import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import CardContextMenu from './card-context-menu.component';

// The native MenuView is a Fabric host component with no software fallback, so
// the global jest setup mocks it to a plain View that forwards every prop —
// letting this test read the actions it was handed and drive onPressAction.

describe('CardContextMenu', () => {
  it('wraps a deletable card in a long-press native menu offering a destructive Delete', async () => {
    const { getByTestId } = await render(
      <CardContextMenu name="Black card" deletable onDelete={jest.fn()}>
        <Text>card</Text>
      </CardContextMenu>,
    );

    const menu = getByTestId('card-context-menu');
    expect(menu.props.shouldOpenOnLongPress).toBe(true);
    expect(menu.props.actions).toEqual([
      {
        id: 'delete',
        title: 'Delete "Black card"',
        attributes: { destructive: true },
        image: 'trash',
      },
    ]);
  });

  it('runs onDelete when the native menu reports the Delete action pressed', async () => {
    const onDelete = jest.fn();
    const { getByTestId } = await render(
      <CardContextMenu name="Black card" deletable onDelete={onDelete}>
        <Text>card</Text>
      </CardContextMenu>,
    );

    getByTestId('card-context-menu').props.onPressAction({ nativeEvent: { event: 'delete' } });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders a synced (non-deletable) card bare, with no menu to intercept the touch-and-hold drag', async () => {
    const { queryByTestId, getByText } = await render(
      <CardContextMenu name="Synced" deletable={false} onDelete={jest.fn()}>
        <Text>card</Text>
      </CardContextMenu>,
    );

    expect(queryByTestId('card-context-menu')).toBeNull();
    expect(getByText('card')).toBeTruthy();
  });
});
