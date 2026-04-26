# OpenBrain local Docker Compose setup

This is a single-machine Docker Compose adaptation of the OB1 Kubernetes self-hosted deployment.

It runs:

- `db`: local PostgreSQL + pgvector
- `mcp`: OpenBrain MCP HTTP server running on Deno

The database is persisted at:

```text
./data/postgres
```

## Start

```bash
cp .env.example .env
# edit .env and set secrets/API keys

docker compose up -d --build
./test-tools-list.sh
```

## MCP endpoint

```text
http://localhost:8000
```

Required auth header:

```text
x-brain-key: value-from-MCP_ACCESS_KEY
```

## Important data note

The PostgreSQL data stays local, but the MCP server sends thought text to the configured embedding API and chat API:

- `/embeddings` for semantic vectors
- `/chat/completions` for metadata extraction

Use only providers approved for the data you capture.

## Changing embedding models

The default schema uses `vector(1536)`, matching OpenAI `text-embedding-3-small`.

If you use a model with a different embedding dimension, update every `vector(1536)` in `init/init.sql` before first run. If the DB already exists, changing `init.sql` will not reinitialize it; you need to migrate the table or delete `./data/postgres` and start fresh.

## Stop

```bash
docker compose down
```

## Delete local stored data

```bash
docker compose down
rm -rf ./data/postgres
```
