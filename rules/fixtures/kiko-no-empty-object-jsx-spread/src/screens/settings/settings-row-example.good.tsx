// Semgrep fixture (NEGATIVE): kiko-code-style's "JSX spread: no `{}`
// fallback". `kiko-no-empty-object-jsx-spread` MUST report nothing here: every
// spread below falls back to a non-empty value, or is no JSX spread at all.

declare const SettingsRow: (props: { label: string; trailing?: unknown }) => null;
declare const switchProps: { trailing: string } | undefined;
declare const selected: boolean;
declare const rowProps: { label: string };

// The ReminderRow fix: the fallback names the discriminant, so the union holds.
const NO_SWITCH = { trailing: undefined };

export const namedFallback = <SettingsRow {...(switchProps ?? NO_SWITCH)} label="Statement import" />;

// SelectableRow's glyph: both branches are non-empty objects.
export const bothBranchesFilled = (
  <SettingsRow {...(selected ? { trailing: 'On' } : { trailing: 'Off' })} label="Statement import" />
);

export const plainSpread = <SettingsRow {...rowProps} />;

// An object spread outside JSX checks no component's props.
export const objectSpread = { ...(switchProps ?? {}) };
