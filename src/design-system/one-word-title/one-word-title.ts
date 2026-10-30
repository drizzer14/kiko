/** Whether `title` is a single word, which a narrow line can only break in the middle. */
export const isOneWordTitle = (title: string): boolean => !/\s/u.test(title.trim());
