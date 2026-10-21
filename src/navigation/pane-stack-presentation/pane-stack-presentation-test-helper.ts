import { isValidElement, type ReactElement, type ReactNode } from 'react';

type Options = { presentation?: string };

type OptionsOrFunction = Options | ((args: { route: { params: unknown } }) => Options);

type NavigatorElement = ReactElement<{
  screenOptions?: OptionsOrFunction;
  children: unknown;
}>;

type ScreenElement = ReactElement<{
  name: string;
  options?: OptionsOrFunction;
}>;

const resolved = (options: OptionsOrFunction | undefined, params: object): Options | undefined =>
  typeof options === 'function' ? options({ route: { params } }) : options;

/**
 * Test helper: the registrations of a rendered pane-stack navigator (the navigator itself counts
 * as `<navigator>`) whose resolved options set a `presentation` other than the default push, as
 * `name:presentation`. A pane's stack reads `FixedContentMarginContext`, which a modal presented
 * from it would inherit, so every pane-stack screen must stay a push. An options function is
 * resolved with `params` as its route's params.
 */
export const nonPushPresentations = (
  rendered: ReactNode | Promise<ReactNode>,
  params: object = {},
): string[] => {
  const { props } = rendered as NavigatorElement;

  return [
    ['<navigator>', resolved(props.screenOptions, params)] as const,
    ...[props.children]
      .flat()
      .filter((child): child is ScreenElement => isValidElement(child))
      .map((screen) => [screen.props.name, resolved(screen.props.options, params)] as const),
  ]
    .filter(([, options]) => options?.presentation !== undefined)
    .filter(([, options]) => options?.presentation !== 'card')
    .map(([name, options]) => `${name}:${options?.presentation}`);
};
