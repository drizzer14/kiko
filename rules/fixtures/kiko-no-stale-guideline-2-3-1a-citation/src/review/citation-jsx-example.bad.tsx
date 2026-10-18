// Semgrep fixture (POSITIVE): a JSX comment cites the stale number.
// `kiko-no-stale-guideline-2-3-1a-citation` MUST report a finding on the JSX comment line below; it
// carries no EXPECT-FINDING pin because a pin line inside JSX children would render as text.

export const StaleCitation = () => (
  <>
    {/* Nothing here is hidden (Guideline 2.3.1(a)). */}
    {null}
  </>
);
