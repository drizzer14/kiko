export type StatementImportFooterProps = {
  hasStats: boolean;
  hasInput: boolean;
  // Import is ALWAYS enabled — this disables it ONLY while an import is
  // actually in flight, never behind a `!canImport` gate. See
  // `handleImport`'s own doc comment (`statement-import.screen.tsx`).
  importing: boolean;
  onImport: () => void;
  onMapColumnsManually: () => void;
};
