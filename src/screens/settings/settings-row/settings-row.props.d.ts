import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

type SettingsRowBaseProps = ViewProps & {
  // The SF Symbol name for the row's optional leading icon.
  icon?: string;
  label: string;
  // The row's body. On a static row it is full width below the label (e.g.
  // the inline base-currency switch, or a hint caption below a `trailing`
  // toggle); on a pressable row it wraps beside the control and chevron,
  // which center on the label and body together.
  children?: ReactNode;
};

// `onPress` is present only for a navigating row (e.g. the Categories row) —
// it turns the row into a Pressable and renders the trailing chevron.
// `trailing` is an inline control on the SAME line as the label, pinned to the
// row's trailing edge and centered on the label (a toggle reads as one row
// with its label, not stacked below it the way a picker/segmented control
// does). A pressable row with `children` centers the control and chevron on
// the label and body together instead.
type SettingsRowStaticProps = SettingsRowBaseProps & {
  onPress?: undefined;
  trailing?: ReactNode;
};

type SettingsRowNavigatingProps = SettingsRowBaseProps & {
  onPress: () => void;
  trailing?: undefined;
};

// iOS reads an accessible Pressable and its children as ONE VoiceOver
// element, so a control inside a navigating row is out of reach: the row
// itself must offer the control's action. Every `trailing` in the app is a
// control, so any `trailing` on a navigating row demands it; a plain value
// beside a chevron would be read in the row's own label and need no action.
type SettingsRowNavigatingWithControlProps = SettingsRowBaseProps & {
  onPress: () => void;
  trailing: ReactNode;
  accessibilityActions: NonNullable<ViewProps['accessibilityActions']>;
  onAccessibilityAction: NonNullable<ViewProps['onAccessibilityAction']>;
};

export type SettingsRowProps =
  | SettingsRowStaticProps
  | SettingsRowNavigatingProps
  | SettingsRowNavigatingWithControlProps;
