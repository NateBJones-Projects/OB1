import type { Context, MiddlewareHandler } from "hono";
import { MCP_ACCESS_KEY, IDENTITY_MODE, LOCAL_OWNER_ID } from "./config.js";

export interface Identity {
  owner_id: string;
  owner_email: string;
}

export const identityMiddleware: MiddlewareHandler = async (c, next) => {
  const key = c.req.header("x-brain-key") ?? c.req.query("key");

  if (!key || key !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }

  if (IDENTITY_MODE === "local") {
    c.set("owner_id", LOCAL_OWNER_ID);
    c.set("owner_email", "local@localhost");
  } else if (IDENTITY_MODE === "entra") {
    // TODO: Stage 2 — implement Entra OIDC token validation and owner_id extraction
    return c.json({ error: "Entra identity mode not yet implemented" }, 501);
  }

  await next();
};

export function getIdentity(c: Context): Identity {
  const owner_id = c.get("owner_id") as string | undefined;
  const owner_email = c.get("owner_email") as string | undefined;

  if (!owner_id || !owner_email) {
    throw new Error(
      "[identity] owner_id or owner_email missing from context — identityMiddleware was not applied to this route"
    );
  }

  return { owner_id, owner_email };
}
