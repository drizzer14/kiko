import {
  type NavigationContainerRefWithCurrent,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import type { ComponentType } from 'react';
import { render, waitFor } from '@testing-library/react-native';

type StackRef = NavigationContainerRefWithCurrent<ParamListBase>;

// What a navigator test reads off the stack it renders: the route names, bottom to top, and the key
// of the route with a name.
export const stackProbe = (navigationRef: StackRef) => {
  const routes = () => navigationRef.getRootState()?.routes ?? [];

  return {
    routeNames: (): string[] => routes().map((route) => route.name),
    keyOf: (name: string): string | undefined => routes().find((route) => route.name === name)?.key,
  };
};

export const renderStackInContainer = async (navigationRef: StackRef, Stack: ComponentType) => {
  const view = await render(
    <NavigationContainer ref={navigationRef}>
      <Stack />
    </NavigationContainer>,
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return view;
};
