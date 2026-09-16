import { recallParameters, writebackParameters } from "../src/tool-schemas.js";

const checks = [
  {
    name: "openbrain_recall",
    schema: recallParameters,
    expectedProperties: ["schema_version", "query", "entities", "scope", "limits", "sensitivity"],
  },
  {
    name: "openbrain_writeback",
    schema: writebackParameters,
    expectedProperties: ["schema_version", "memory_payload", "provenance", "retention", "visibility"],
  },
];

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

function assertObjectProperties(name, schema, expectedProperties) {
  const properties = schema?.properties || {};
  const propertyNames = Object.keys(properties);
  if (schema?.type !== "object") fail(`${name} must be an object schema`);
  if (propertyNames.length === 0) fail(`${name} must expose named top-level properties`);
  if (schema.patternProperties && propertyNames.length === 0) {
    fail(`${name} relies only on patternProperties`);
  }

  const missing = expectedProperties.filter((property) => !propertyNames.includes(property));
  if (missing.length) fail(`${name} is missing expected properties: ${missing.join(", ")}`);
}

function assertNoPatternOnlyObjects(name, schema, path = name) {
  if (!schema || typeof schema !== "object") return;

  const properties = schema.properties || {};
  if (schema.type === "object" && schema.patternProperties && Object.keys(properties).length === 0) {
    fail(`${path} is a patternProperties-only object schema`);
  }

  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    assertNoPatternOnlyObjects(name, propertySchema, `${path}.${propertyName}`);
  }

  if (schema.items) assertNoPatternOnlyObjects(name, schema.items, `${path}[]`);
  for (const branchKey of ["anyOf", "allOf", "oneOf"]) {
    for (const [index, branch] of (schema[branchKey] || []).entries()) {
      assertNoPatternOnlyObjects(name, branch, `${path}.${branchKey}[${index}]`);
    }
  }
}

for (const check of checks) {
  assertObjectProperties(check.name, check.schema, check.expectedProperties);
  assertNoPatternOnlyObjects(check.name, check.schema);
}

console.log(JSON.stringify({
  ok: true,
  checked_tools: checks.map((check) => check.name),
}, null, 2));
