/**
 * The shape shared by every repository module: a record of named query and
 * write functions. Applied with `satisfies Repository` so each repo's object
 * literal is constrained to this shape (every value must be a function) without
 * widening away the precise per-method signatures callers rely on.
 *
 * `(...args: never[]) => unknown` is the bottom function type — every concrete
 * method (whatever its parameters and return) is assignable to it.
 */
export type Repository = Record<string, (...args: never[]) => unknown>;
