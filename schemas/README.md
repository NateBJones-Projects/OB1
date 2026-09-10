# Schemas

https://github.com/user-attachments/assets/9454662f-2648-4928-8723-f7d52e94e9b8

Database table extensions and metadata schemas for your Supabase database. Drop them in alongside your existing `thoughts` table.

| Schema | What It Does |
| ------ | ------------ |
| [Agent Memory](agent-memory/) | Sidecar tables that turn existing `thoughts` into governed, provenance-labeled operational memory for agent workflows |
| [Reading List](reading-list/) | Standalone `reading_list` table for books, articles, podcasts, and videos with ratings, review notes, tags, and want-to-read → reading → finished status tracking |

> **Looking for CRM?** See [`extensions/professional-crm`](../extensions/professional-crm/) — it includes schema + a full MCP server.

## Ideas

- Taste preferences tracker

## Contributing

Schemas are open for community contributions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
