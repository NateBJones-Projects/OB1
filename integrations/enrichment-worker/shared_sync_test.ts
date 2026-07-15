// Vendored _shared/ must stay byte-identical to enhanced-mcp/_shared/.
// If this fails: re-run the cp commands in the README, never hand-edit _shared/.
import { assertEquals } from "jsr:@std/assert";

for (const f of ["helpers.ts", "config.ts"]) {
  Deno.test(`vendored _shared/${f} matches enhanced-mcp`, async () => {
    const vendored = await Deno.readTextFile(
      new URL(`./_shared/${f}`, import.meta.url),
    );
    const canonical = await Deno.readTextFile(
      new URL(`../enhanced-mcp/_shared/${f}`, import.meta.url),
    );
    assertEquals(vendored, canonical);
  });
}
