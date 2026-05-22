# Gmail OAuth state folder

This folder holds the per-user OAuth token for the Gmail smart pull recipe.

Two files live here, both gitignored:

- `token.json` — written on first run after the OAuth consent flow. Contains
  the refresh token that keeps subsequent runs silent (no browser). Treat it
  like a password; never check it in.
- `credentials.json` — optional. Only if you prefer a file over environment
  variables. The recipe's default path is to read the OAuth client id and
  secret from `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` env vars
  instead, so this file is usually unnecessary.

If you need to re-authorize (e.g. the refresh token was revoked), delete
`token.json` and re-run the script.
