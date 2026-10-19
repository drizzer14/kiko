// Semgrep fixture (NEGATIVE): `kiko-component-explicit-return` MUST report nothing here. A
// component with a block body and an explicit `return` is the form the skill asks for, however
// its props are typed and however many arrows sit in its body or its parameter list. An arrow
// that is not annotated as a component is outside the rule. One component is exported; the rest
// are local, so the guard's one-component-per-file check passes on this file too.
import * as React from 'react';
import type { FC } from 'react';
import { Text, View } from 'react-native';

const NamedProps: FC<{ label: string }> = ({ label }) => {
  return (
    <View>
      <Text>{label}</Text>
    </View>
  );
};

const CallbackInProps: FC<{ label: string; onOpen: () => void }> = ({ label, onOpen }) => {
  return (
    <View>
      <Text onPress={onOpen}>{label}</Text>
    </View>
  );
};

const InnerArrows: FC<{ labels: string[] }> = ({ labels }) => {
  const upper = labels.map((label) => label.toUpperCase());

  return (
    <View>
      {upper.map((label) => (
        <Text key={label}>{label}</Text>
      ))}
    </View>
  );
};

const BareFc: FC = () => {
  return <View />;
};

const ReactFc: React.FC<{ label: string }> = ({ label }) => {
  return <Text>{label}</Text>;
};

const Wrapped: FC<{ label: string }> = React.memo(({ label }) => <Text>{label}</Text>);

const render = (label: string) => <Text>{label}</Text>;

const trim = ({ label }: { label: string }): string => label.trim();

export const Showcase: FC = () => {
  return (
    <View>
      <NamedProps label="a" />

      <CallbackInProps label="b" onOpen={() => {}} />

      <InnerArrows labels={['c']} />

      <BareFc />

      <ReactFc label="d" />

      <Wrapped label="e" />

      {render(trim({ label: ' f ' }))}
    </View>
  );
};
