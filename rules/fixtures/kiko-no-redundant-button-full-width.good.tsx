import Button from '@kiko/design-system/components/button';

// Semgrep fixture (NEGATIVE): `kiko-no-redundant-button-full-width` MUST
// report nothing on a Button that keeps the default width, opts out with
// `fullWidth={false}`, or computes it, nor on another component's own
// `fullWidth` prop (its own default).

const onPress = (): void => undefined;

const Card = ({ fullWidth, children }: { fullWidth?: boolean; children: string }) =>
  fullWidth ? children : null;

export const defaultWidthButton = (
  <Button variant="primary" onPress={onPress}>
    Save
  </Button>
);

export const intrinsicWidthButton = (
  <Button variant="ghost" size="small" fullWidth={false} onPress={onPress}>
    Cancel
  </Button>
);

export const computedWidthButton = (isCompact: boolean) => (
  <Button fullWidth={!isCompact} onPress={onPress}>
    Continue
  </Button>
);

export const selfClosingIntrinsicWidthButton = (
  <Button icon="plus" accessibilityLabel="Add" fullWidth={false} onPress={onPress} />
);

export const fullWidthCard = <Card fullWidth>Summary</Card>;
