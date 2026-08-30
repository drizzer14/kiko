import type { FC, ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

export type ScreenProps = {
  children?: ReactNode;
};

export const Screen: FC<ScreenProps> = ({ children }) => (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.content}>{children}</View>
  </SafeAreaView>
);

const styles = StyleSheet.create(theme => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    padding: theme.spacing(4),
  },
}));
