import { View } from 'react-native';
import { type FC, type ReactNode, useState } from 'react';
import { TabRouter, useNavigationBuilder } from '@react-navigation/native';

// Mounts a tab only once it is first focused and keeps it mounted after, as the native bottom tabs
// do, on the real TabRouter.
const LazyTabs: FC<{ children: ReactNode; initialRouteName?: string }> = ({
  children,
  initialRouteName,
}) => {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    children,
    initialRouteName,
  });
  const focusedKey = state.routes[state.index]?.key ?? '';
  const [loadedKeys, setLoadedKeys] = useState([focusedKey]);

  if (!loadedKeys.includes(focusedKey)) {
    setLoadedKeys([...loadedKeys, focusedKey]);
  }

  return (
    <NavigationContent>
      {state.routes
        .filter((route) => loadedKeys.includes(route.key))
        .map((route) => (
          <View key={route.key} style={route.key === focusedKey ? undefined : { display: 'none' }}>
            {descriptors[route.key]?.render()}
          </View>
        ))}
    </NavigationContent>
  );
};

export default LazyTabs;
