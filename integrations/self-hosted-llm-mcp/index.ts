import { createApp, productionDeps } from "./lib/app.ts";

Deno.serve(createApp(productionDeps()).fetch);
