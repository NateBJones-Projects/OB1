import { Type } from "typebox";

const schemaVersion = (value) => Type.Optional(Type.Literal(value));
const nullableString = () => Type.Union([Type.String(), Type.Null()]);
const optionalNullableString = () => Type.Optional(nullableString());
const optionalStringArray = () => Type.Optional(Type.Array(Type.String()));
const optionalNullableInteger = () => Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]));

const channelSchema = Type.Object({
  kind: Type.Optional(Type.String()),
  id: optionalNullableString(),
  thread_id: optionalNullableString(),
});

const runtimeSchema = Type.Object({
  name: Type.Optional(Type.String()),
  version: optionalNullableString(),
});

const entitiesSchema = Type.Object({
  people: optionalStringArray(),
  orgs: optionalStringArray(),
  repos: optionalStringArray(),
  files: optionalStringArray(),
  customers: optionalStringArray(),
  topics: optionalStringArray(),
});

export const recallParameters = Type.Object({
  schema_version: schemaVersion("openbrain.openclaw.recall.v1"),
  project_id: optionalNullableString(),
  task_id: optionalNullableString(),
  flow_id: optionalNullableString(),
  task_type: optionalNullableString(),
  channel: Type.Optional(channelSchema),
  runtime: Type.Optional(runtimeSchema),
  model_intent: Type.Optional(Type.Object({
    provider: optionalNullableString(),
    model: optionalNullableString(),
  })),
  query: Type.String(),
  entities: Type.Optional(entitiesSchema),
  scope: Type.Optional(Type.Object({
    visibility: optionalNullableString(),
    project_only: Type.Optional(Type.Boolean()),
    include_unconfirmed: Type.Optional(Type.Boolean()),
    include_stale: Type.Optional(Type.Boolean()),
  })),
  limits: Type.Optional(Type.Object({
    max_items: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    max_tokens: Type.Optional(Type.Integer({ minimum: 256, maximum: 20000 })),
    recency_days: optionalNullableInteger(),
  })),
  sensitivity: Type.Optional(Type.Object({
    contains_code: Type.Optional(Type.Boolean()),
    contains_customer_data: Type.Optional(Type.Boolean()),
    contains_private_meeting_data: Type.Optional(Type.Boolean()),
  })),
});

const memoryPayloadSchema = Type.Object({
  decisions: optionalStringArray(),
  outputs: optionalStringArray(),
  lessons: optionalStringArray(),
  constraints: optionalStringArray(),
  unresolved_questions: optionalStringArray(),
  next_steps: optionalStringArray(),
  failures: optionalStringArray(),
  artifacts: Type.Optional(Type.Array(Type.Object({
    kind: Type.String(),
    uri: Type.String(),
    description: optionalNullableString(),
  }))),
  entities: Type.Optional(entitiesSchema),
});

export const writebackParameters = Type.Object({
  schema_version: schemaVersion("openbrain.openclaw.writeback.v1"),
  project_id: optionalNullableString(),
  task_id: optionalNullableString(),
  flow_id: optionalNullableString(),
  step_id: optionalNullableString(),
  idempotency_key: optionalNullableString(),
  content_hash: optionalNullableString(),
  channel: Type.Optional(channelSchema),
  runtime: Type.Optional(runtimeSchema),
  models_used: Type.Optional(Type.Array(Type.Object({
    provider: Type.String(),
    model: Type.String(),
    role: Type.String(),
  }))),
  source_refs: Type.Optional(Type.Array(Type.Object({
    kind: Type.String(),
    uri: optionalNullableString(),
    title: optionalNullableString(),
    timestamp: optionalNullableString(),
  }))),
  memory_payload: memoryPayloadSchema,
  provenance: Type.Optional(Type.Object({
    default_status: Type.Optional(Type.Union([
      Type.Literal("observed"),
      Type.Literal("inferred"),
      Type.Literal("user_confirmed"),
      Type.Literal("imported"),
      Type.Literal("generated"),
    ])),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    requires_review: Type.Optional(Type.Boolean()),
  })),
  retention: Type.Optional(Type.Object({
    ttl_days: optionalNullableInteger(),
    stale_after_days: optionalNullableInteger(),
  })),
  visibility: Type.Optional(Type.Object({
    workspace: optionalNullableString(),
    project: optionalNullableString(),
    channel: optionalNullableString(),
  })),
});
