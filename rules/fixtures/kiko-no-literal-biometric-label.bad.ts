// Semgrep fixture (POSITIVE): the native LocalAuthentication prompt's
// cancelLabel/fallbackLabel bypass i18n entirely when given a string
// literal — kiko-no-literal-biometric-label MUST report a finding on the
// pinned line below. Never "fix" this file to route the label through
// i18n.t(...) — that belongs in the .good.ts fixture instead.
export const buildOptions = (prompt: string) => ({
  title: prompt,
  allowDeviceCredentials: true,
  // EXPECT-FINDING
  cancelLabel: 'Cancel',
  fallbackLabel: 'Use Passcode',
});
