#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CATEGORY_NOUNS = {
  recipes: "Recipe",
  schemas: "Schema",
  dashboards: "Dashboard",
  integrations: "Integration",
  skills: "Skill",
  primitives: "Primitive",
  extensions: "Extension",
};

class ScaffoldError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function commaList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateAnswers(schema, answers, rootDir) {
  const required = ["category", "slug", "name", "description", "author", "difficulty", "estimatedTime"];
  for (const field of required) {
    if (!String(answers[field] || "").trim()) throw new ScaffoldError(`Missing required value: ${field}`);
  }

  if (!CATEGORY_NOUNS[answers.category]) {
    throw new ScaffoldError(`Invalid category: ${answers.category}`);
  }
  if (!SLUG_PATTERN.test(answers.slug)) {
    throw new ScaffoldError("Slug must contain only lowercase letters, numbers, and single hyphens.");
  }
  // Dependency slugs land in metadata and in relative README links, so they get
  // the same rule as the destination slug. Without it a traversal entry such as
  // ".." is written verbatim and points outside the category. They must also
  // actually exist: gate rule 10 rejects a contribution whose declared
  // dependency directory is missing, so a typo would otherwise scaffold
  // "successfully" and then fail CI.
  for (const [flag, value, dependencyCategory] of [
    ["--requires-skills", answers.requiresSkills, "skills"],
    ["--requires-primitives", answers.requiresPrimitives, "primitives"],
  ]) {
    for (const dependency of commaList(value)) {
      if (!SLUG_PATTERN.test(dependency)) {
        throw new ScaffoldError(
          `Invalid ${flag} entry: ${dependency}. Use lowercase letters, numbers, and single hyphens.`,
        );
      }
      if (!fs.existsSync(path.join(rootDir, dependencyCategory, dependency))) {
        throw new ScaffoldError(
          `Unknown ${flag} entry: ${dependency}. ${dependencyCategory}/${dependency}/ does not exist.`,
        );
      }
    }
  }

  const difficulties = schema.properties?.difficulty?.enum || [];
  if (!difficulties.includes(answers.difficulty)) {
    throw new ScaffoldError(`Invalid difficulty: ${answers.difficulty}. Choose ${difficulties.join(", ")}.`);
  }

  const tags = commaList(answers.tags);
  if (tags.length === 0) throw new ScaffoldError("At least one tag is required.");

  if (answers.category === "extensions" && String(answers.learningOrder ?? "").trim()) {
    const learningOrder = Number(answers.learningOrder);
    if (!Number.isInteger(learningOrder) || learningOrder < 1) {
      throw new ScaffoldError("Extensions require a positive integer learning order.");
    }
  }
}

function buildMetadata(template, answers) {
  const metadata = structuredClone(template);
  metadata.name = answers.name.trim();
  metadata.description = answers.description.trim();
  metadata.category = answers.category;
  metadata.author = { name: answers.author.trim() };
  if (answers.github?.trim()) metadata.author.github = answers.github.trim().replace(/^@/, "");
  metadata.version = "1.0.0";
  metadata.requires = { ...metadata.requires, open_brain: true };
  metadata.tags = commaList(answers.tags);
  metadata.difficulty = answers.difficulty;
  metadata.estimated_time = answers.estimatedTime.trim();

  const requiredSkills = commaList(answers.requiresSkills);
  const requiredPrimitives = commaList(answers.requiresPrimitives);
  if (requiredSkills.length) metadata.requires_skills = requiredSkills;
  else delete metadata.requires_skills;
  if (requiredPrimitives.length) {
    metadata.requires_primitives = [...new Set([...commaList(metadata.requires_primitives), ...requiredPrimitives])];
  } else if (answers.category !== "extensions") delete metadata.requires_primitives;

  if (answers.category === "extensions" && String(answers.learningOrder ?? "").trim()) {
    metadata.learning_order = Number(answers.learningOrder);
  } else delete metadata.learning_order;

  const today = new Date().toISOString().slice(0, 10);
  if ("created" in metadata) metadata.created = today;
  if ("updated" in metadata) metadata.updated = today;
  return metadata;
}

// Replacement values come from user input, so they must be inserted literally.
// Passing them as replacement strings would let JavaScript's `$&`, `$1`, `` $` ``
// and `$'` patterns rewrite the output (e.g. --name 'Cash $& Carry').
const literal = (value) => () => value;

function substituteTemplate(content, answers) {
  const noun = CATEGORY_NOUNS[answers.category];
  return content
    .replaceAll(`${noun} Name`, literal(answers.name))
    .replaceAll(`${noun.toUpperCase()} NAME`, literal(answers.name.toUpperCase()))
    .replaceAll(`${noun.toLowerCase()}-name`, literal(answers.slug))
    .replaceAll("Your Name", literal(answers.author))
    .replaceAll("your-github-username", literal((answers.github || "your-github-username").replace(/^@/, "")))
    .replace(/> One-line description[^\n]*/g, literal(`> ${answers.description}`));
}

function appendDependencyLinks(readme, answers) {
  const links = [
    ...commaList(answers.requiresSkills).map((slug) => `- [${slug}](../../skills/${slug}/)`),
    ...commaList(answers.requiresPrimitives).map((slug) => `- [${slug}](../../primitives/${slug}/)`),
  ];
  if (!links.length) return readme;
  return `${readme.trimEnd()}\n\n## Contribution Dependencies\n\nInstall or review these dependencies before continuing:\n\n${links.join("\n")}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function edgeFunctionStarter(answers) {
  const contribution = JSON.stringify(
    { name: answers.name.trim(), description: answers.description.trim() },
    null,
    2,
  );
  return `const contribution = ${contribution} as const;

Deno.serve((request) => {
  if (request.method !== "POST") {
    return new Response("Send a POST request to this endpoint.", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  return Response.json({
    contribution,
    message: "Replace this starter response with your remote integration handler.",
  });
});
`;
}

function addCategoryArtifacts(targetDir, answers) {
  if (answers.category === "schemas") {
    fs.writeFileSync(
      path.join(targetDir, "schema.sql"),
      "-- Replace example_table with the table created by this contribution.\n-- Add CREATE TABLE, indexes, and row-level security policies above this grant.\n\ngrant select, insert, update, delete on table public.example_table to service_role;\n",
    );
  }

  if (answers.category === "dashboards") {
    fs.writeFileSync(
      path.join(targetDir, "index.html"),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(answers.name)}</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(answers.name)}</h1>
      <p>${escapeHtml(answers.description)}</p>
      <p>Replace this starter page with your Open Brain dashboard.</p>
    </main>
  </body>
</html>
`,
    );
  }

  if (answers.category === "integrations") {
    fs.writeFileSync(path.join(targetDir, "index.ts"), edgeFunctionStarter(answers));
  }

  if (answers.category === "extensions") {
    const tableName = `${answers.slug.replaceAll("-", "_")}_items`;
    fs.writeFileSync(
      path.join(targetDir, "schema.sql"),
      `create table if not exists public.${tableName} (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.${tableName} enable row level security;

create policy "${tableName}_owner"
on public.${tableName}
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.${tableName} to service_role;
`,
    );
    fs.writeFileSync(path.join(targetDir, "index.ts"), edgeFunctionStarter(answers));
  }

  if (answers.category === "primitives") {
    const readmePath = path.join(targetDir, "README.md");
    const readme = fs
      .readFileSync(readmePath, "utf8")
      .replaceAll("[Extension Name](../../extensions/extension-slug/)", "Extension Name");
    fs.writeFileSync(
      readmePath,
      `${readme.trimEnd()}\n\n## Prerequisites\n\n- A working Open Brain setup\n\n## Submission Checklist\n\nBefore submitting, replace every placeholder with specific guidance drawn from a working Open Brain setup. Expand the explanation, patterns, and numbered steps so another contributor can follow the guide without guessing. Keep examples copy-paste ready, describe a concrete expected result, and document likely failure modes. Verify that the completed README contains at least 200 words and names the extensions that use this primitive.\n`,
    );
  }

  if (["dashboards", "integrations"].includes(answers.category)) {
    const readmePath = path.join(targetDir, "README.md");
    const readme = fs.readFileSync(readmePath, "utf8");
    fs.writeFileSync(
      readmePath,
      `${readme.trimEnd()}\n\n## Remote MCP Deployment\n\nIf this contribution exposes MCP tools, deploy them as a Supabase Edge Function and connect through your AI client's URL-based custom connector. Do not use a local MCP server.\n`,
    );
  }
}

function selfCheck(rootDir, metadataPath) {
  const schema = JSON.parse(fs.readFileSync(path.join(rootDir, ".github", "metadata.schema.json"), "utf8"));
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const missing = schema.required.filter((field) => !(field in metadata));
  if (missing.length) throw new ScaffoldError(`Generated metadata is missing: ${missing.join(", ")}`);
  if (metadata.requires?.open_brain !== true) {
    throw new ScaffoldError("Generated metadata must set requires.open_brain to true.");
  }
  if (!schema.properties.difficulty.enum.includes(metadata.difficulty)) {
    throw new ScaffoldError(`Generated metadata has invalid difficulty: ${metadata.difficulty}`);
  }
  return metadata;
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

export function scaffold(rootDir, answers) {
  const root = path.resolve(rootDir);
  const schemaPath = path.join(root, ".github", "metadata.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const normalized = {
    ...answers,
    category: String(answers.category || "").trim(),
    slug: String(answers.slug || "").trim(),
  };
  validateAnswers(schema, normalized, root);

  const templateDir = path.join(root, normalized.category, "_template");
  if (!fs.statSync(templateDir).isDirectory()) throw new ScaffoldError(`Template not found: ${templateDir}`);

  const targetDir = path.join(root, normalized.category, normalized.slug);
  if (fs.existsSync(targetDir)) throw new ScaffoldError(`Target already exists: ${targetDir}`, 2);

  const temporaryDir = path.join(root, normalized.category, `.new-${normalized.slug}-${process.pid}`);
  try {
    const extensionSpec = path.join(templateDir, "AGENT_SPEC.md");
    fs.cpSync(templateDir, temporaryDir, {
      recursive: true,
      filter: (source) => normalized.category !== "extensions" || source !== extensionSpec,
    });
    const templateMetadata = JSON.parse(fs.readFileSync(path.join(templateDir, "metadata.json"), "utf8"));
    const metadata = buildMetadata(templateMetadata, normalized);

    for (const filePath of listFiles(temporaryDir)) {
      if (path.basename(filePath) === "metadata.json") continue;
      const content = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(filePath, substituteTemplate(content, normalized));
    }

    const readmePath = path.join(temporaryDir, "README.md");
    fs.writeFileSync(readmePath, appendDependencyLinks(fs.readFileSync(readmePath, "utf8"), normalized));
    addCategoryArtifacts(temporaryDir, normalized);
    fs.writeFileSync(path.join(temporaryDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    selfCheck(root, path.join(temporaryDir, "metadata.json"));
    fs.renameSync(temporaryDir, targetDir);

    return {
      createdPaths: listFiles(targetDir),
      metadata: selfCheck(root, path.join(targetDir, "metadata.json")),
    };
  } catch (error) {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

async function collectAnswers(values) {
  const answers = {
    category: values.category,
    slug: values.slug,
    name: values.name,
    description: values.description,
    author: values.author,
    github: values.github,
    difficulty: values.difficulty,
    estimatedTime: values["estimated-time"],
    tags: values.tags,
    requiresSkills: values["requires-skills"],
    requiresPrimitives: values["requires-primitives"],
    learningOrder: values["learning-order"],
  };
  const prompts = {
    category: "Category",
    slug: "Folder slug",
    name: "Contribution name",
    description: "Description",
    author: "Author name",
    difficulty: "Difficulty (beginner/intermediate/advanced)",
    estimatedTime: "Estimated time",
    tags: "Tags (comma-separated)",
  };

  const requiredFields = Object.keys(prompts);
  const missing = requiredFields.filter((field) => !String(answers[field] || "").trim());
  if (!missing.length) return answers;
  if (values.yes || !process.stdin.isTTY) {
    throw new ScaffoldError(`Missing required flags: ${missing.map((field) => `--${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`).join(", ")}`);
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!answers.category) answers.category = await readline.question(`${prompts.category}: `);
    for (const field of Object.keys(prompts)) {
      if (!answers[field]) answers[field] = await readline.question(`${prompts[field]}: `);
    }
    if (!answers.github) answers.github = await readline.question("GitHub username (optional): ");
    if (!answers.requiresSkills) answers.requiresSkills = await readline.question("Required skill slugs (comma-separated, optional): ");
    if (!answers.requiresPrimitives) answers.requiresPrimitives = await readline.question("Required primitive slugs (comma-separated, optional): ");
    return answers;
  } finally {
    readline.close();
  }
}

async function main() {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      category: { type: "string" },
      slug: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      author: { type: "string" },
      github: { type: "string" },
      difficulty: { type: "string" },
      "estimated-time": { type: "string" },
      tags: { type: "string" },
      "requires-skills": { type: "string" },
      "requires-primitives": { type: "string" },
      "learning-order": { type: "string" },
      yes: { type: "boolean", default: false },
    },
  });
  const answers = await collectAnswers(values);
  const result = scaffold(process.cwd(), answers);
  const relativeDir = path.join(answers.category, answers.slug);
  console.log(`Created ${relativeDir}/ (${result.createdPaths.length} files).`);
  if (fs.existsSync(path.join(process.cwd(), "scripts", "validate-contribution.mjs"))) {
    console.log(`Next: node scripts/validate-contribution.mjs ${relativeDir}`);
  } else {
    console.log("Next: review the CI rule list in .github/workflows/ob1-gate-v2.yml.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = error.exitCode || 1;
  });
}
