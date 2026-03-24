# Kubernetes Self-Hosted Deployment

<div align="center">

![Community Contribution](https://img.shields.io/badge/OB1_COMMUNITY-Approved_Contribution-2ea44f?style=for-the-badge&logo=github)

**Created by [@velo](https://github.com/velo)**

*Reviewed and merged by the Open Brain maintainer team — thank you for building the future of AI memory!*

</div>

> Deploy Open Brain on Kubernetes with self-hosted PostgreSQL + pgvector, replacing Supabase with fully self-managed infrastructure.

## What It Does

This integration provides Kubernetes manifests and a modified MCP server that connects directly to PostgreSQL instead of Supabase. Your thoughts database, embeddings, and MCP endpoint all run on your own cluster. The MCP HTTP endpoint is served via Kubernetes Ingress, making it a remote endpoint accessible by URL from any MCP client.

## Prerequisites

- Working Kubernetes cluster (tested on K3s v1.31, works with any K8s distribution)
- `kubectl` configured for your cluster
- Docker installed (for building the MCP server image)
- An embedding/chat API provider (OpenRouter, OpenAI, or a local model with OpenAI-compatible API)
- An ingress controller (Traefik, nginx-ingress, etc.) if you want external access

## Credential Tracker

Copy this block into a text editor and fill it in as you go.

```text
KUBERNETES DEPLOYMENT -- CREDENTIAL TRACKER
--------------------------------------------

POSTGRESQL
  Password:              ____________

MCP SERVER
  Access key:            ____________

EMBEDDING/CHAT API
  API base URL:          ____________
  API key:               ____________
  Embedding model:       ____________
  Chat model:            ____________

--------------------------------------------
```

## Steps

### 1. Build the MCP Server Docker Image

From this directory, build and import the image:

```bash
docker build -t openbrain-mcp-server:latest .

# For K3s:
docker save openbrain-mcp-server:latest | sudo k3s ctr images import -

# For minikube:
minikube image load openbrain-mcp-server:latest

# For other clusters, push to your registry:
docker tag openbrain-mcp-server:latest your-registry/openbrain-mcp-server:latest
docker push your-registry/openbrain-mcp-server:latest
```

### 2. Configure Secrets

```bash
cp k8s/secrets.yml.example k8s/secrets.yml
```

Edit `k8s/secrets.yml` with your actual credentials. **Never commit this file.**

### 3. Deploy to Kubernetes

```bash
kubectl apply -f k8s/secrets.yml
kubectl apply -f k8s/openbrain.yml
```

### 4. Verify Deployment

```bash
# Check pod status
kubectl get pods -n openbrain

# Check database is initialized
kubectl exec -n openbrain openbrain-0 -c db -- \
  psql -U postgres -d openbrain -c '\dt'

# Test MCP endpoint (via port-forward)
kubectl port-forward -n openbrain svc/openbrain 8000:8000 &
curl -X POST http://localhost:8000 \
  -H "x-brain-key: YOUR_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### 5. Connect Your MCP Client

For Claude Desktop or any MCP-compatible client, configure the remote MCP endpoint:

```json
{
  "mcpServers": {
    "openbrain": {
      "url": "http://openbrain.openbrain.svc.cluster.local:8000",
      "transport": "http",
      "headers": {
        "x-brain-key": "YOUR_ACCESS_KEY"
      }
    }
  }
}
```

If you've configured an Ingress, use your external URL instead:

```json
{
  "mcpServers": {
    "openbrain": {
      "url": "https://brain.yourdomain.com",
      "transport": "http",
      "headers": {
        "x-brain-key": "YOUR_ACCESS_KEY"
      }
    }
  }
}
```

## Using a Local LLM Instead of OpenRouter

To use a local model (e.g., Ollama, BitNet, llama.cpp) for embeddings and chat, update the environment variables in `k8s/openbrain.yml`:

```yaml
- name: EMBEDDING_API_BASE
  value: "http://your-local-model:8080/v1"
- name: EMBEDDING_API_KEY
  value: "not-needed"
- name: EMBEDDING_MODEL
  value: "your-model-name"
- name: CHAT_API_BASE
  value: "http://your-local-model:8080/v1"
- name: CHAT_API_KEY
  value: "not-needed"
- name: CHAT_MODEL
  value: "your-model-name"
```

If your embedding model produces a different vector dimension than 1536, update the `vector(1536)` in the init SQL to match.

## Expected Outcome

After deployment you should see:

- `openbrain-0` pod running with 2 containers (db + mcp-server)
- PostgreSQL with `thoughts` table and `match_thoughts` function
- MCP endpoint responding to `tools/list` with 4 tools: `search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`
- Thoughts captured via any MCP client are stored in your self-hosted database

## Troubleshooting

**Pod stuck in CrashLoopBackOff (mcp-server)**
- Check logs: `kubectl logs -n openbrain openbrain-0 -c mcp-server`
- Most common cause: invalid API key or unreachable embedding API base URL
- For local models, ensure the model service is running and accessible from the cluster

**Database not initialized / tables missing**
- The init SQL runs only on first startup. If the data volume already exists with an old database, the init script is skipped.
- To re-initialize: delete the data volume directory and restart the pod
- `kubectl delete pod openbrain-0 -n openbrain` (StatefulSet will recreate it)

**Embedding dimension mismatch**
- If you see errors about vector dimensions, your embedding model produces vectors of a different size than expected
- Check your model's output dimension and update `vector(1536)` in the init SQL ConfigMap
- Drop and recreate the `thoughts` table if changing dimensions on an existing database

**Connection refused to database**
- Containers in the same pod communicate via `127.0.0.1` — this is normal Kubernetes multi-container pod behavior
- Check that the `db` container is ready: `kubectl logs -n openbrain openbrain-0 -c db`
