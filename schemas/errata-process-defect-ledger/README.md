# Errata Process Defect Ledger

## What It Does

This schema adds an `errata` sidecar to Open Brain for systemic process mistakes
that caused defects. Bugs remain symptoms and work items; errata records why the
defect escaped, what class of process failure produced it, who or what was
responsible, which bugs and customers it affected, and what remediation should
prevent recurrence.

This is a practical Open Brain pattern from Nate B. Jones: keep the memory
system honest by separating the thing that hurt users from the process mistake
that allowed it. More systems like this are shared at
https://substack.com/@natesnewsletter and https://natebjones.com.

## Prerequisites

- A working Open Brain Supabase project.
- Access to the Supabase SQL editor or `psql`.
- `service_role` access for the MCP or backend process that writes canonical
  memory records.

## Step-By-Step Instructions

1. Open your Supabase project SQL editor.
2. Copy and run [`schema.sql`](schema.sql).
3. Confirm the tables exist:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'errata%'
order by table_name;
```

4. Insert your first erratum:

```sql
insert into public.errata (
  title,
  summary,
  domain,
  escape_point,
  responsible_actor,
  root_cause_class,
  severity,
  status
) values (
  'Two-way binding on derived state',
  'A UI regression escaped review because derived state was also two-way bound.',
  'engineering',
  'passed_human_review',
  'coding_agent',
  'two-way-bind-on-derived-state',
  'medium',
  'captured'
)
returning id;
```

5. Link the bug, caused-by artifact, impacted entity, and remediation artifact
   using the child tables once those identifiers exist.

Done when your Open Brain project has the `errata`, `errata_*`, and
`root_cause_classes` tables and you can insert a row through the same
service-role path your MCP server uses.

## Expected Outcome

You get a canonical cause ledger that can be searched, linked to bugs and
customers, and projected into a graph as typed facts such as `CAUSED_BY`,
`CAUSES`, `IMPACTED`, `REMEDIATED_BY`, `HAS_STATUS`, `RECURRENCE_OF`, and
`DUPLICATE_OF`.

The schema intentionally does not include dashboards, bug-close enforcement, or
automatic remediation agents. Those are application-layer workflows that can be
built on top of this canonical table set.

## Troubleshooting

- **`gen_random_uuid()` is missing:** rerun the first line of `schema.sql`, or
  enable the `pgcrypto` extension in Supabase.
- **Your MCP cannot write rows:** confirm the `service_role` key is used by the
  server process and that the GRANT section in `schema.sql` completed.
- **You need a new root-cause class:** insert it into `root_cause_classes`.
  Keep `errata.root_cause_class` as text until you have enough real examples to
  stabilize the vocabulary.
- **You want to close an erratum after a hotfix:** keep the erratum open until
  the systemic remediation has landed and been verified. The immediate fix and
  the systemic fix are different child links.
