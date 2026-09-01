function require(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const MCP_ACCESS_KEY: string = require("MCP_ACCESS_KEY");
export const QDRANT_URL: string = require("QDRANT_URL");

export const PORT: number = parseInt(optional("PORT", "3100"));
export const AWS_REGION: string = optional("AWS_REGION", "us-east-1");
export const AWS_PROFILE: string = optional("AWS_PROFILE", "default");
export const AWS_CREDENTIALS_FILE: string =
  process.env.AWS_SHARED_CREDENTIALS_FILE ||
  `${process.env.HOME || "/root"}/.aws/credentials`;
export const EMBEDDING_MODEL: string = optional(
  "EMBEDDING_MODEL",
  "amazon.titan-embed-text-v2:0"
);
export const METADATA_MODEL: string = optional(
  "METADATA_MODEL",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0"
);
export const IDENTITY_MODE: string = optional("IDENTITY_MODE", "local");
export const LOCAL_OWNER_ID: string = optional("LOCAL_OWNER_ID", "local-user");
