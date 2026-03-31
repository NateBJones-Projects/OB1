import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell hero">
      <section className="card">
        <span className="pill">Open Brain OAuth Portal</span>
        <h1 className="headline">Sign in once. Approve only what your connector asks for.</h1>
        <p className="lede">
          This portal is the minimal auth surface for Open Brain MCP. Claude, ChatGPT, and other
          remote MCP clients redirect here when they need OAuth approval.
        </p>
        <div className="button-row">
          <Link className="button" href="/login">
            Sign In
          </Link>
          <Link className="ghost-button" href="/oauth/consent?authorization_id=demo">
            Preview Consent Layout
          </Link>
        </div>
      </section>

      <section className="grid cards">
        <article className="card">
          <h2>What It Does</h2>
          <p className="muted">
            Handles password sign-in, shows the client name and requested scopes, and sends the
            approval or denial back to Supabase Auth.
          </p>
        </article>
        <article className="card">
          <h2>What It Does Not Do</h2>
          <p className="muted">
            No dashboard, no admin panel, no extra product surface. Keep it small so auth stays
            understandable and easy to operate solo.
          </p>
        </article>
        <article className="card">
          <h2>Deploy Pattern</h2>
          <p className="muted">
            Host this on Vercel, point Supabase OAuth 2.1 at the consent route, and let your MCP
            servers validate the resulting bearer token.
          </p>
        </article>
      </section>
    </main>
  );
}
