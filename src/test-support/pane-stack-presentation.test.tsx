import { createElement, Fragment, type ReactElement } from 'react';

import { nonPushPresentations } from './pane-stack-presentation';

const screen = (name: string, options?: unknown) => createElement('screen', { name, options });

const group = (screenOptions: unknown, ...children: ReactElement[]) =>
  createElement('group', { screenOptions }, ...children);

const navigator = (screenOptions: unknown, ...children: ReactElement[]) =>
  createElement('navigator', { screenOptions }, ...children);

describe('nonPushPresentations', () => {
  it('is empty for screens that push, whether the default or a card', () => {
    expect(
      nonPushPresentations(
        navigator(
          { headerShown: false },
          screen('Plain'),
          screen('Card', { presentation: 'card' }),
          screen('Function', () => ({ title: 'x' })),
        ),
      ),
    ).toEqual([]);
  });

  it('names a screen whose static options present it as a modal', () => {
    expect(
      nonPushPresentations(navigator(undefined, screen('Sheet', { presentation: 'modal' }))),
    ).toEqual(['Sheet:modal']);
  });

  it('names a screen whose options function presents it as a form sheet', () => {
    expect(
      nonPushPresentations(
        navigator(
          undefined,
          screen('Sheet', () => ({ presentation: 'formSheet' })),
        ),
      ),
    ).toEqual(['Sheet:formSheet']);
  });

  it('resolves an options function with the params it is given', () => {
    const sheetFor = ({ route }: { route: { params: { kind?: string } } }) => ({
      presentation: route.params.kind,
    });

    expect(nonPushPresentations(navigator(undefined, screen('Sheet', sheetFor)))).toEqual([]);
    expect(
      nonPushPresentations(navigator(undefined, screen('Sheet', sheetFor)), { kind: 'modal' }),
    ).toEqual(['Sheet:modal']);
  });

  it('names every screen of a group whose screen options present it as a modal', () => {
    expect(
      nonPushPresentations(
        navigator(
          undefined,
          screen('Plain'),
          group({ presentation: 'modal' }, screen('First'), screen('Second')),
        ),
      ),
    ).toEqual(['First:modal', 'Second:modal']);
  });

  it('lets a screen of a modal group keep its own presentation, and reads a function group', () => {
    expect(
      nonPushPresentations(
        navigator(
          undefined,
          group(
            { presentation: 'modal' },
            screen('Pushed', { presentation: 'card' }),
            screen('Sheet', { presentation: 'formSheet' }),
          ),
          group(() => ({ presentation: 'fullScreenModal' }), screen('Full')),
        ),
      ),
    ).toEqual(['Sheet:formSheet', 'Full:fullScreenModal']);
  });

  it('looks inside a fragment and a nested group', () => {
    expect(
      nonPushPresentations(
        navigator(
          undefined,
          createElement(
            Fragment,
            null,
            screen('Plain'),
            group({ presentation: 'modal' }, group(undefined, screen('Deep'))),
          ),
        ),
      ),
    ).toEqual(['Deep:modal']);
  });

  it('names the navigator when its screen options present every screen as a modal', () => {
    expect(
      nonPushPresentations(navigator({ presentation: 'fullScreenModal' }, screen('Plain'))),
    ).toEqual(['<navigator>:fullScreenModal']);
  });
});
