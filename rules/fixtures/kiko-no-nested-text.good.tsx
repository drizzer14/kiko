// Semgrep fixture (NEGATIVE): `kiko-no-nested-text` MUST report nothing here. A `Text` or a
// `MoneyText` beside a `Text`, a `Text` inside a `View`, a `Text` with only strings and
// non-text children, and a `Text` inside the expression of a sibling `View` are all outside the
// rule, which is about an element of the text family inside another. One component is exported;
// the rest are local, so the guard's one-component-per-file check passes on this file too.
import { Text, View } from 'react-native';

const MoneyText = (_props: { money: number }) => {
  return null;
};

const Icon = () => {
  return null;
};

type ShowcaseProps = { label: string; show: boolean; items: string[] };

export const Showcase = ({ label, show, items }: ShowcaseProps) => {
  return (
    <View>
      <Text>Total</Text>

      <MoneyText money={100} />

      <Text>
        {label} {show ? 'shown' : 'hidden'}
      </Text>

      <Text>
        <Icon />
      </Text>

      <View>
        {items.map((item) => (
          <Text key={item}>{item}</Text>
        ))}
      </View>
    </View>
  );
};
