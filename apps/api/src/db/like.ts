/** Escapes `%`, `_` and the escape character itself for a `LIKE ... ESCAPE '\'` pattern. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);
