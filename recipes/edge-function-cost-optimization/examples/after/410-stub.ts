// ✅ HTTP 410 Gone stub for a deprecated edge function.
//
// Drop this in place of the old `index.ts` for each function you've
// consolidated into the unified server. Returns a structured "moved"
// response so reconfigured clients know exactly where to point.
//
// After ~2 weeks (once you're confident no clients still hit the old URL),
// run `supabase functions delete <name>` to remove entirely.

const NEW_PATH = "/functions/v1/open-brain-mcp";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-brain-key, x-access-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const newUrl = `${url.protocol}//${url.host}${NEW_PATH}${url.search}`;

  return new Response(
    JSON.stringify({
      error: "moved",
      message:
        "This function has been merged into open-brain-mcp. " +
        "Update your Claude Desktop connector URL.",
      new_url: newUrl,
      docs: "https://github.com/NateBJones-Projects/OB1/tree/main/recipes/edge-function-cost-optimization",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
});
