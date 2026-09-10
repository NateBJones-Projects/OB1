import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "fs";
import {
  AWS_REGION,
  AWS_PROFILE,
  AWS_CREDENTIALS_FILE,
  EMBEDDING_MODEL,
  METADATA_MODEL,
} from "./config.js";

export function readCredentials() {
  const text = readFileSync(AWS_CREDENTIALS_FILE, "utf8").replace(/\r/g, "");
  const sections: Record<string, Record<string, string>> = {};
  let current = "";
  for (const line of text.split("\n")) {
    const section = line.match(/^\[(.+)\]/);
    if (section) { current = section[1]; sections[current] = {}; continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && current) sections[current][kv[1].trim()] = kv[2].trim();
  }
  const profile = sections[AWS_PROFILE] || sections["default"];
  if (!profile?.aws_access_key_id) throw new Error(`No credentials found for profile: ${AWS_PROFILE}`);
  return {
    accessKeyId: profile.aws_access_key_id,
    secretAccessKey: profile.aws_secret_access_key,
    ...(profile.aws_session_token ? { sessionToken: profile.aws_session_token } : {}),
  };
}

// Called per-request so rotating session tokens are always picked up from the live credentials file.
export function makeBedrock() {
  return new BedrockRuntimeClient({
    region: AWS_REGION,
    credentials: readCredentials(),
  });
}

export async function getEmbedding(text: string): Promise<number[]> {
  const cmd = new InvokeModelCommand({
    modelId: EMBEDDING_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });
  const resp = await makeBedrock().send(cmd);
  const body = JSON.parse(new TextDecoder().decode(resp.body));
  return body.embedding;
}

export async function extractMetadata(text: string): Promise<{
  type: string;
  topics: string[];
  people: string[];
  action_items: string[];
  dates_mentioned?: string[];
}> {
  const cmd = new InvokeModelCommand({
    modelId: METADATA_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: `Extract metadata from the following thought and return a JSON object with these fields:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there. Return only the JSON object, nothing else.

Thought: ${text}`,
      }],
    }),
  });
  const resp = await makeBedrock().send(cmd);
  const body = JSON.parse(new TextDecoder().decode(resp.body));
  try {
    const match = body.content[0].text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { topics: ["uncategorized"], type: "observation", people: [], action_items: [] };
  } catch {
    return { topics: ["uncategorized"], type: "observation", people: [], action_items: [] };
  }
}
