# Primitives

https://github.com/user-attachments/assets/f488e495-fe2a-4ccc-a834-fc6ab5a0ed41

Primitives are reusable concept guides that show up in multiple extensions. Learn them once, apply them everywhere.

| Primitive | What It Teaches | Used By |
| --------- | --------------- | ------- |
| [Deploy an Edge Function](deploy-edge-function/) | Deploying any extension as a Supabase Edge Function | All extensions |
| [Remote MCP Connection](remote-mcp/) | Connecting to Claude Desktop, ChatGPT, Claude Code, Cursor, and other clients | All extensions |
| [Common Troubleshooting](troubleshooting/) | Solutions for connection, deployment, and database issues | All extensions |
| [Row Level Security](rls/) | PostgreSQL policies for multi-user data isolation | Extensions 4, 5, 6 |
| [Shared MCP Server](shared-mcp/) | Giving others scoped access to parts of your brain | Extension 4 |

## How Primitives Work

Extensions link to primitives when they introduce a concept for the first time. Instead of re-explaining Row Level Security in three different extensions, the RLS primitive teaches it once — and each extension focuses on applying it to its specific use case.

You don't need to read primitives in advance. Each extension tells you when to read one.

## Contributing

Primitives are **curated** — a primitive should be referenced by at least 2 extensions to justify extraction. [Propose a new primitive](https://github.com/NateBJones-Projects/OB1/issues/new?template=primitive-submission.yml).
