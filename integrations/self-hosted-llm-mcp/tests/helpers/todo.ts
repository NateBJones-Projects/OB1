/**
 * Stand-in for node:test's `todo`: an outer-loop acceptance test that is
 * ignored in a normal run and executed only with RUN_TODO=1, so its red can be
 * recorded without failing the suite. Stream A flips each `todo(` to
 * `Deno.test(` in the commit that turns it green.
 */
export function todo(name: string, fn: () => void | Promise<void>): void {
  Deno.test({ name, ignore: Deno.env.get("RUN_TODO") !== "1", fn });
}
