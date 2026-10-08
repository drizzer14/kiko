import Button from '@kiko/design-system/components/button';

// Semgrep fixture (POSITIVE): the design-system Button defaults `fullWidth`
// to true, so a bare `fullWidth` or `fullWidth={true}` restates the default.
// `kiko-no-redundant-button-full-width` MUST report a finding on each pinned
// Button below (Semgrep reports parenthesized JSX at its opening line).

const onPress = (): void => undefined;

const isCompact = false;

// EXPECT-FINDING
export const bareFullWidthButton = (
  <Button variant="primary" fullWidth onPress={onPress}>
    Save
  </Button>
);

// EXPECT-FINDING
export const trueFullWidthButton = (
  <Button variant="secondary" fullWidth={true} onPress={onPress}>
    Export
  </Button>
);

// EXPECT-FINDING
export const bareFullWidthFirstButton = (
  <Button
    fullWidth
    variant="secondaryTonal"
    onPress={onPress}
    icon="doc.badge.plus"
  >
    Import statement
  </Button>
);

// EXPECT-FINDING
export const selfClosingBareFullWidthButton = (
  <Button fullWidth icon="plus" accessibilityLabel="Add" onPress={onPress} />
);

// EXPECT-FINDING
export const selfClosingTrueFullWidthButton = (
  <Button icon="plus" accessibilityLabel="Add" fullWidth={true} onPress={onPress} />
);

// A constant that folds to `true` restates the default too.
// EXPECT-FINDING
export const constantFullWidthButton = (
  <Button fullWidth={!isCompact} onPress={onPress}>
    Continue
  </Button>
);

export const footerButtons = [
  // EXPECT-FINDING
  <Button key="add" fullWidth onPress={onPress}>
    Add holding
  </Button>,
];
