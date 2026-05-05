<!-- MYBCAT-GUIDELINES-START -->
<!-- DO NOT EDIT BETWEEN THESE MARKERS - managed by mybcat-sync-guidelines -->
<!-- Last synced: 2026-04-02 13:17:49 -->
## MyBCAT Universal Rules (Lean v2)
## Red-teamed by Codex HIPAA review 2026-04-02. Grown from real incidents.

## Outcome
MyBCAT is a managed back-office and call center service for 30+ U.S. optometry practices.
We handle PHI (patient names, insurance, call recordings). HIPAA compliance is mandatory.
Built primarily with AI coding agents (Claude Code). Founder is not a software engineer.
Revenue: ~$1.3M annualized. 60+ remote Filipino agents. 3-person tech team.

## Risk Profile
Single AWS account (no dev/prod separation). All systems are production. PHI-bearing databases and call recordings. Large tables (100K–1.37M rows). Manual deploys only.

## Security (HIPAA — non-negotiable)
- Never log, display, or store PHI (patient names, emails, insurance IDs, phone numbers, payment info) in plaintext.
- All patient-facing endpoints require Cognito auth with MFA (TOTP minimum). No anonymous access to PHI.
- Row-level security: users see only their tenant's data.
- S3 PHI storage requires encryption (KMS preferred). RDS SGs restricted to VPC CIDR.
- Rate-limit all public API Gateway endpoints. WAF required on public endpoints.
- Never expose internal tools (n8n, Metabase) to 0.0.0.0/0.
- No 0.0.0.0/0 ingress on ANY security group — we had 5+ DBs exposed this way.
- All DB queries use parameterized statements. No string interpolation in SQL.
- Credentials go in AWS Secrets Manager via `secret-store` CLI. Never in chat, code, comments, or git URLs — agents have leaked credentials in Google Chat before.
- Never embed GitHub tokens in git remote URLs. Use SSH or credential helpers.

## Infrastructure Safety
- No security group modifications without explicit approval.
- No DB migrations without a snapshot. We have no rollback procedures.
- No DynamoDB Contacts table structure changes without approval (1.37M records, high blast radius).
- No direct pushes to main on repos with CI/CD. Branch + PR required.
- No infrastructure deploy without `terraform plan` review first.
- IaC via Terraform exclusively (no console-created resources).
- Manual CI/CD trigger only — never auto-deploy to prod.
- RDS backup retention minimum 35 days. Snapshot before every migration.
- Bland AI: versioned pathway endpoint only. Edge labels don't persist on non-versioned.
- Assume production scale. Avoid full-table scans on large tables. Add indexes or justify why none are needed.
- DynamoDB: use Query with GSI, never Scan on tables >100K items.
- Run CloudFormation drift detection monthly.

## Code Standards (security-relevant)
- Python: use logging module, not print — print can leak PHI to stdout. Lambda handlers return proper status codes.
- TypeScript: strict mode — enforces auth/tenant boundary safety.
- Every API endpoint includes error handling with user-friendly messages. No raw errors to users.
- All repos must have CI that runs lint + build before merge to main.

## Working Boundaries
- If a task will touch more than 3 files, propose a plan and wait for approval.
- Before destructive operations (DELETE, DROP, TRUNCATE, SG changes), state what you're about to do.
- Fresh session per logical task — prevents cross-client PHI context bleed.
- If working more than 5 minutes without results, stop and reassess.

## Response Quality Rules
- Say "I don't know" when uncertain. Do not guess, fabricate, or speculate without actual knowledge.
- Verify with citations. Back up factual claims with sources — documentation links, file paths, line numbers, or command output.
- Use direct quotes for factual grounding. Quote relevant text directly from code, docs, or sources rather than paraphrasing.

## Available Tools
- AWS MCP (102 read-only tools for infrastructure inspection)
- MyBCAT Ops MCP (1,126 docs, operational knowledge)
- MyBCAT Playbook MCP (security audits, procedures, onboarding)
- GitHub (CI/CD, repos, PRs)
- Terraform (infrastructure management)
- `secret-store` CLI (secrets management)

## Full Operational Playbook
For deeper context beyond these rules, query the **mybcat-playbook MCP** (`search_playbook`, `get_playbook_doc`, `list_playbook`):
- Security audit with findings, remediation steps, and fix prompts
- Business context: clients, team, services, tech stack, compliance posture
- Task decomposition templates for safely making risky changes
- Engineer onboarding briefing for new contractors or team members
- Nate's operational frameworks: blast radius discipline, scar tissue rules, 80-20 threshold

<!-- MYBCAT-GUIDELINES-END -->
