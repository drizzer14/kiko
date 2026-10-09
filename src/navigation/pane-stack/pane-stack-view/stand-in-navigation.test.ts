import { CommonActions, StackActions } from '@react-navigation/native';

import { PaneActions } from '../pane-router';

import { standInNavigation } from './stand-in-navigation';

type Navigation = Record<string, (...args: unknown[]) => unknown>;

const refuse = () => {
  throw new Error('Actions cannot be dispatched from a placeholder screen.');
};

// What React Navigation hands a screen it renders without a route in the state: every action
// helper, `dispatch` and `setOptions` throw.
const placeholderNavigation = (): Navigation => ({
  ...Object.fromEntries(
    [...Object.keys(CommonActions), ...Object.keys(StackActions), ...Object.keys(PaneActions)].map(
      (name) => [name, refuse],
    ),
  ),
  dispatch: refuse,
  setOptions: refuse,
  isFocused: () => false,
});

const KEY = 'pane-default:companion';
const dispatch = jest.fn();

const standIn = (): Navigation => {
  const descriptor = { route: { key: KEY }, navigation: placeholderNavigation() };

  return standInNavigation(descriptor, dispatch).navigation;
};

describe('standInNavigation', () => {
  beforeEach(() => {
    dispatch.mockClear();
  });

  it('keeps the descriptor and hands back the same navigation object it was given', () => {
    const descriptor = { route: { key: KEY }, navigation: placeholderNavigation() };
    const { navigation } = descriptor;

    expect(standInNavigation(descriptor, dispatch)).toBe(descriptor);
    expect(descriptor.navigation).toBe(navigation);
  });

  it.each([
    ['navigate', (navigation: Navigation) => navigation.navigate('Form', { id: 'a' })],
    ['push', (navigation: Navigation) => navigation.push('Form', { id: 'a' })],
    [
      'a dispatched navigate',
      (navigation: Navigation) => navigation.dispatch(CommonActions.navigate('Form', { id: 'a' })),
    ],
    [
      'a dispatched push',
      (navigation: Navigation) => navigation.dispatch(StackActions.push('Form', { id: 'a' })),
    ],
  ])('opens the route in the pane opposite the default on %s', (_label, call) => {
    call(standIn());

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(PaneActions.open(KEY, 'Form', { id: 'a' }));
  });

  it.each([
    ['goBack', (navigation: Navigation) => navigation.goBack()],
    ['pop', (navigation: Navigation) => navigation.pop()],
    ['popToTop', (navigation: Navigation) => navigation.popToTop()],
    ['popTo', (navigation: Navigation) => navigation.popTo('Form')],
    ['replace', (navigation: Navigation) => navigation.replace('Form')],
    ['setParams', (navigation: Navigation) => navigation.setParams({ id: 'a' })],
    ['setOptions', (navigation: Navigation) => navigation.setOptions({ title: 'a' })],
    [
      'a dispatched go back',
      (navigation: Navigation) => navigation.dispatch(CommonActions.goBack()),
    ],
    ['a dispatch of a function', (navigation: Navigation) => navigation.dispatch(() => null)],
  ])('does nothing, and does not throw, on %s', (_label, call) => {
    expect(() => call(standIn())).not.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves a navigate that names no route alone', () => {
    standIn().dispatch({ type: 'NAVIGATE', payload: {} });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps the members that were never helpers', () => {
    expect(standIn().isFocused()).toBe(false);
  });
});
