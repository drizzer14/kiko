// Semgrep fixture (POSITIVE): kiko-design-system's "Native chrome follows the window" keeps a
// `Text` or a `MoneyText` out of another `Text`. `kiko-no-nested-text` MUST report a finding on
// each pinned line, where the OUTER `Text` starts (the line of its opening parenthesis here):
// the inner element as a direct child (a `Text` and a `MoneyText`, whole or self-closing),
// after other children, and inside a child expression (a conditional, a logical and, a `.map`
// callback).
import { Text } from 'react-native';

const MoneyText = (_props: { money: number }) => {
  return null;
};

// EXPECT-FINDING
export const directText = (
  <Text>
    Total <Text>bold</Text>
  </Text>
);

// EXPECT-FINDING
export const directSelfClosingText = (
  <Text>
    Total <Text />
  </Text>
);

// EXPECT-FINDING
export const directMoneyText = (
  <Text>
    Balance <MoneyText money={100} />
  </Text>
);

// EXPECT-FINDING
export const lastChild = (
  <Text numberOfLines={1}>
    Balance
    <MoneyText money={100} />
  </Text>
);

// EXPECT-FINDING
export const afterExpression = (label: string) => (
  <Text>
    {label}
    <Text>suffix</Text>
  </Text>
);

// EXPECT-FINDING
export const insideConditional = (show: boolean) => (
  <Text>
    Total {show ? <Text>shown</Text> : null}
  </Text>
);

// EXPECT-FINDING
export const insideLogicalAnd = (show: boolean) => (
  <Text>
    Total {show && <MoneyText money={100} />}
  </Text>
);

// EXPECT-FINDING
export const insideMap = (items: string[]) => (
  <Text>
    {items.map((item) => (
      <Text key={item}>{item}</Text>
    ))}
  </Text>
);
