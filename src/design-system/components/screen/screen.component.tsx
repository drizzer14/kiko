import type { FC } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ScreenProps } from './screen.props';
import { styles } from './screen.styles';

const Screen: FC<ScreenProps> = ({ children }) => (
  <SafeAreaView style={styles.safeArea}>
    <View style={styles.content}>{children}</View>
  </SafeAreaView>
);

export default Screen;
