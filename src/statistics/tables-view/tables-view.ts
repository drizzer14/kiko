/** The tables the Tables screen switches between, in the order its control lists them. */
export const TABLES_VIEWS = ['categories', 'cashFlow'] as const;

export type TablesView = (typeof TABLES_VIEWS)[number];
