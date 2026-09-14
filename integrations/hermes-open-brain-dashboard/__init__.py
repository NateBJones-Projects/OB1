"""Open Brain Browser plugin registration.

The desktop/backend package exposes no model-facing tools or hooks. Its Python
API uses Hermes' capability-gated MCP client directly.
"""


def register(ctx):
    del ctx
