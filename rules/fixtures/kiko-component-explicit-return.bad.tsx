// Semgrep fixture (POSITIVE): kiko-code-style's "One component per file, each in its own folder"
// makes a component return with an explicit `return`. `kiko-component-explicit-return` MUST
// report a finding on each pinned line: an `FC` arrow whose body is an expression, with the
// props typed by a name, by an inline type that holds a callback type, by bare `FC`, and by
// `React.FC`, and with a body that is a `&&` expression or `null`.
import type { FC } from 'react';
import * as React from 'react';
import { Text, View } from 'react-native';

// EXPECT-FINDING
export const NamedProps: FC<{ label: string }> = ({ label }) => (
  <View>
    <Text>{label}</Text>
  </View>
);

// EXPECT-FINDING
export const CallbackInProps: FC<{ label: string; onOpen: () => void }> = ({ label, onOpen }) => (
  <View>
    <Text onPress={onOpen}>{label}</Text>
  </View>
);

// EXPECT-FINDING
export const BareFc: FC = () => <View />;

// EXPECT-FINDING
export const ReactFc: React.FC<{ label: string }> = ({ label }) => <Text>{label}</Text>;

// EXPECT-FINDING
export const Guarded: FC<{ label: string | null }> = ({ label }) =>
  label && (
    <View>
      <Text>{label}</Text>
    </View>
  );

// EXPECT-FINDING
export const Nothing: FC<{ label: string }> = () => null;
