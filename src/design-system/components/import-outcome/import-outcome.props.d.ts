import type { ImportResult } from '@kiko/statement-import/import-statement';

export type ImportOutcomeProps = {
  /** The last successful `importStatement` result, if any. A caught failure
   * is no longer rendered here: it shows as a translated
   * `Alert.alert(t(errorTitle), t(errorMessage))`, the same pattern
   * `import-data.screen.tsx` already uses, instead of raw untranslated
   * `error.message` sitting passively at the bottom of the page. */
  result?: ImportResult;
};
