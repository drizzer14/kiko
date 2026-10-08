// Semgrep fixture (POSITIVE): kiko-code-style's "JSX spread: no `{}`
// fallback". A JSX spread of `X | {}` makes every prop of X optional, so a
// discriminated union's required-together props (SettingsRowProps: a
// pressable row's `trailing` needs `accessibilityActions` and
// `onAccessibilityAction`) stop being enforced.
// `kiko-no-empty-object-jsx-spread` MUST report a finding on every pinned
// line below: each one spreads a value whose fallback is an empty object.

declare const SettingsRow: (props: { label: string; trailing?: unknown; children?: unknown }) => null;
declare const Card: (props: { children?: unknown }) => null;
declare const switchProps: { trailing: string } | undefined;
declare const paused: boolean;

// The ReminderRow case before its fix: the switch and its actions, or `{}`.
// EXPECT-FINDING
export const nullishFallback = <SettingsRow {...(switchProps ?? {})} label="Statement import" />;

// EXPECT-FINDING
export const orFallback = <SettingsRow {...(switchProps || {})} label="Statement import" />;

// EXPECT-FINDING
export const ternaryElseFallback = <SettingsRow {...(paused ? { trailing: 'Off' } : {})} label="Statement import" />;

// EXPECT-FINDING
export const ternaryThenFallback = <SettingsRow {...(paused ? {} : { trailing: 'On' })} label="Statement import" />;

// EXPECT-FINDING
export const unparenthesizedFallback = <SettingsRow {...switchProps ?? {}} label="Statement import" />;

// EXPECT-FINDING
export const spacedFallback = <SettingsRow {...(switchProps ?? { })} label="Statement import" />;

// An element with children.
// EXPECT-FINDING
export const withChildren = <SettingsRow {...(switchProps ?? {})} label="Statement import">
  {'Every month'}
</SettingsRow>;

// An element nested inside another element.
// EXPECT-FINDING
export const nested = <Card><SettingsRow {...(switchProps ?? {})} label="Statement import" /></Card>;
