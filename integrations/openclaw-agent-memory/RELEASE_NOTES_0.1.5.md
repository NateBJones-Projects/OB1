# NBJ OB1 Agent Memory for OpenClaw 0.1.5

Tool-argument compatibility fix for OpenClaw and Claude.

## Changed

- Replaces generic record schemas for `openbrain_recall` and `openbrain_writeback` with explicit TypeBox object schemas.
- Keeps recall and write-back API payloads runtime-neutral while making the OpenClaw tool contract model-friendly.
- Injects OpenClaw schema versions and configured workspace defaults in the plugin client.
- Adds a schema regression check so recall and write-back cannot silently regress to patternProperties-only tool schemas.

## Verification Target

After publish, a clean OpenClaw profile should install the plugin and call all seven OB1 Agent Memory tools. The recall and write-back trajectory entries should include populated payloads instead of `{}`.
