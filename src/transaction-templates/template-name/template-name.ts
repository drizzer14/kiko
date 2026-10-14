// JS folding, never SQL: SQLite's lower() folds ASCII only, so "Оренда" and "оренда" would
// both pass a SQL name check.
export const templateNameKey = (name: string): string => name.trim().toLowerCase();

export const isTemplateNameTaken = (
  name: string,
  templates: readonly { id: string; name: string }[],
  exceptId: string | null,
): boolean => {
  const key = templateNameKey(name);

  return templates.some(
    (template) => template.id !== exceptId && templateNameKey(template.name) === key,
  );
};
