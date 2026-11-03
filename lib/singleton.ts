// Next.js compiles every route handler with its own copy of each module it imports, so two files
// that both import the in-memory store would otherwise hold two separate stores. State that must be
// one per process lives on globalThis under a Symbol.for key, and every copy of a module finds the
// same value. (The tests also depend on this: they reset the store from the test file and expect the
// route handlers to see the same data.)

const registry = globalThis as unknown as Record<symbol, unknown>;

export function singleton<T>(name: string, create: () => T): T {
  const key = Symbol.for(`kazi-connect.${name}`);
  if (!(key in registry)) registry[key] = create();
  return registry[key] as T;
}
