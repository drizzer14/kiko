import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import ImplicitKindField from '.';

const setup = async (selected: 'property' | 'debt' = 'property') => {
  const onSelectImplicit = jest.fn();
  const onSelectAccountKind = jest.fn();

  const utils = await render(
    <ImplicitKindField
      selected={selected}
      onSelectImplicit={onSelectImplicit}
      onSelectAccountKind={onSelectAccountKind}
    />,
  );

  const pick = async (kind: string): Promise<void> => {
    await fireEvent.press(utils.getByTestId('account-kind-field'));
    await fireEvent.press(utils.getByTestId(`account-kind-field-option-${kind}`));
  };

  return { onSelectImplicit, onSelectAccountKind, pick, ...utils };
};

describe('ImplicitKindField', () => {
  it('shows the selected implicit kind', async () => {
    const { getByTestId } = await setup('debt');

    expect(getByTestId('account-kind-field')).toHaveTextContent('Debt');
  });

  it('is never disabled, since the whole point is to pick another kind', async () => {
    const { getByTestId } = await setup();

    expect(getByTestId('account-kind-field').props.accessibilityState.disabled).toBeFalsy();
  });

  it('lists every account kind with its subtitle', async () => {
    const { getAllByTestId, getByTestId } = await setup();

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(getAllByTestId(/^account-kind-field-option-[a-z]+$/)).toHaveLength(7);
    expect(getByTestId('account-kind-field-option-broker-description')).toHaveTextContent(
      'Bonds and cash at a broker.',
    );
  });

  it('reports a kind that creates an account as an account kind', async () => {
    const { onSelectImplicit, onSelectAccountKind, pick } = await setup();

    await pick('bank');

    expect(onSelectAccountKind).toHaveBeenCalledTimes(1);
    expect(onSelectAccountKind).toHaveBeenCalledWith('bank');
    expect(onSelectImplicit).not.toHaveBeenCalled();
  });

  it.each(['property', 'debt'] as const)('reports %s as an implicit kind', async (kind) => {
    const { onSelectImplicit, onSelectAccountKind, pick } = await setup(
      kind === 'property' ? 'debt' : 'property',
    );

    await pick(kind);

    expect(onSelectImplicit).toHaveBeenCalledTimes(1);
    expect(onSelectImplicit).toHaveBeenCalledWith(kind);
    expect(onSelectAccountKind).not.toHaveBeenCalled();
  });
});
