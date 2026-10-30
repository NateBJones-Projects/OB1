import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { scaffold } from "./new-contribution.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./new-contribution.mjs", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CATEGORIES = ["recipes", "schemas", "dashboards", "integrations", "skills", "primitives", "extensions"];
const REQUIRED_FIELDS = ["name", "description", "category", "author", "version", "requires", "tags", "difficulty", "estimated_time"];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-scaffold-"));
  fs.mkdirSync(path.join(root, ".github"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".github", "metadata.schema.json"),
    JSON.stringify({
      required: REQUIRED_FIELDS,
      properties: { difficulty: { enum: ["beginner", "intermediate", "advanced"] } },
    }),
  );

  for (const category of CATEGORIES) {
    const template = path.join(root, category, "_template");
    fs.mkdirSync(template, { recursive: true });
    const noun = category === "recipes" ? "Recipe" : `${category[0].toUpperCase()}${category.slice(1, -1)}`;
    let readme = `# ${noun} Name\n\n> One-line description of this contribution.\n\n## What It Does\n\nTODO\n\n## Prerequisites\n\n- Open Brain\n\n## Steps\n\n1. TODO\n\n## Expected Outcome\n\nTODO\n\n## Troubleshooting\n\nTODO\n`;
    if (category === "extensions") {
      readme += "\n## Why This Matters\n\nTODO\n\n## Learning Path\n\nTODO\n\n## What You'll Learn\n\nTODO\n\n## Cross-Extension Integration\n\nTODO\n\n## Next Steps\n\n[Tool audit](../../docs/05-tool-audit.md)\n";
    }
    if (category === "skills") {
      readme += "\n## Supported Clients\n\n- Codex\n\n## Installation\n\nTODO\n\n## Trigger Conditions\n\nTODO\n";
      fs.writeFileSync(path.join(template, "SKILL.md"), "# Skill Name\n\nPlain-text instructions.\n");
    }
    fs.writeFileSync(path.join(template, "README.md"), readme);
    fs.writeFileSync(
      path.join(template, "metadata.json"),
      JSON.stringify({
        name: `${noun} Name`,
        description: "Template description",
        category,
        author: { name: "Your Name", github: "your-github-username" },
        version: "1.0.0",
        requires: { open_brain: true, services: [], tools: [] },
        tags: ["template"],
        difficulty: "beginner",
        estimated_time: "10 minutes",
      }),
    );
  }
  // Dependency directories the scaffolder now verifies before writing links.
  for (const [category, slug] of [
    ["skills", "auto-capture"],
    ["skills", "meeting-triage"],
    ["primitives", "rls"],
    ["primitives", "deploy-edge-function"],
    ["primitives", "remote-mcp"],
  ]) {
    fs.mkdirSync(path.join(root, category, slug), { recursive: true });
    fs.writeFileSync(path.join(root, category, slug, "README.md"), `# ${slug}\n`);
  }

  return root;
}

function repositoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob1-repository-scaffold-"));
  fs.mkdirSync(path.join(root, ".github"), { recursive: true });
  fs.copyFileSync(
    path.join(REPOSITORY_ROOT, ".github", "metadata.schema.json"),
    path.join(root, ".github", "metadata.schema.json"),
  );
  for (const category of CATEGORIES) {
    fs.cpSync(path.join(REPOSITORY_ROOT, category, "_template"), path.join(root, category, "_template"), {
      recursive: true,
    });
  }
  // The scaffolder verifies declared dependencies exist, so mirror the real
  // primitives the extension template already depends on.
  for (const slug of ["rls", "deploy-edge-function", "remote-mcp"]) {
    fs.mkdirSync(path.join(root, "primitives", slug), { recursive: true });
    fs.writeFileSync(path.join(root, "primitives", slug, "README.md"), `# ${slug}\n`);
  }
  return root;
}

function answers(overrides = {}) {
  return {
    category: "recipes",
    slug: "demo-recipe",
    name: "Demo Recipe",
    description: "A useful demonstration recipe.",
    author: "Test Author",
    github: "test-author",
    difficulty: "beginner",
    estimatedTime: "20 minutes",
    tags: ["demo"],
    ...overrides,
  };
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(entryPath) : [entryPath];
  });
}

function hasExtension(files, extensions) {
  return files.some((file) => extensions.includes(path.extname(file)));
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

test("recipe scaffold produces README and metadata with all required fields", (t) => {
  const root = fixture();
  cleanup(t, root);
  const result = scaffold(root, answers());

  assert.ok(fs.existsSync(path.join(root, "recipes", "demo-recipe", "README.md")));
  assert.ok(fs.existsSync(path.join(root, "recipes", "demo-recipe", "metadata.json")));
  assert.deepEqual(REQUIRED_FIELDS.filter((field) => !(field in result.metadata)), []);
  assert.equal(result.metadata.requires.open_brain, true);
});

test("extension scaffold includes learning order and tool-audit link", (t) => {
  const root = fixture();
  cleanup(t, root);
  const result = scaffold(
    root,
    answers({ category: "extensions", slug: "demo-extension", name: "Demo Extension", learningOrder: 3 }),
  );
  const readme = fs.readFileSync(path.join(root, "extensions", "demo-extension", "README.md"), "utf8");

  assert.equal(result.metadata.learning_order, 3);
  assert.match(readme, /docs\/05-tool-audit\.md/);
  for (const heading of ["Why This Matters", "Learning Path", "What You'll Learn", "Cross-Extension Integration", "Next Steps"]) {
    assert.match(readme, new RegExp(`## ${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
  }
});

test("extension scaffold merges supplied primitives with mandatory template primitives", (t) => {
  const root = repositoryFixture();
  cleanup(t, root);
  const result = scaffold(
    root,
    answers({
      category: "extensions",
      slug: "demo-extension",
      name: "Demo Extension",
      requiresPrimitives: "rls",
      learningOrder: 3,
    }),
  );

  assert.deepEqual(result.metadata.requires_primitives, ["deploy-edge-function", "remote-mcp", "rls"]);
});

test("community extension scaffold omits learning order when not supplied", (t) => {
  const root = repositoryFixture();
  cleanup(t, root);
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--category",
      "extensions",
      "--slug",
      "demo-extension",
      "--name",
      "Demo Extension",
      "--description",
      "A community extension.",
      "--author",
      "Test Author",
      "--difficulty",
      "beginner",
      "--estimated-time",
      "20 minutes",
      "--tags",
      "demo",
      "--yes",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(root, "extensions", "demo-extension", "metadata.json"), "utf8"),
  );

  assert.equal("learning_order" in metadata, false);
});

test("skills scaffold emits a plain-text skill artifact", (t) => {
  const root = fixture();
  cleanup(t, root);
  scaffold(root, answers({ category: "skills", slug: "demo-skill", name: "Demo Skill" }));

  const skill = fs.readFileSync(path.join(root, "skills", "demo-skill", "SKILL.md"), "utf8");
  assert.match(skill, /Demo Skill/);
});

test("schemas scaffold emits SQL containing a grant line", (t) => {
  const root = fixture();
  cleanup(t, root);
  scaffold(root, answers({ category: "schemas", slug: "demo-schema", name: "Demo Schema" }));

  const sql = fs.readFileSync(path.join(root, "schemas", "demo-schema", "schema.sql"), "utf8");
  assert.match(sql, /^grant .+ to service_role;/m);
});

test("every category scaffold satisfies the rule 6 artifact requirement", (t) => {
  const root = repositoryFixture();
  cleanup(t, root);

  for (const category of CATEGORIES) {
    const slug = `demo-${category}`;
    scaffold(
      root,
      answers({
        category,
        slug,
        name: `Demo ${category}`,
        learningOrder: category === "extensions" ? 3 : undefined,
      }),
    );

    const contributionDir = path.join(root, category, slug);
    const files = filesIn(contributionDir);
    const readme = fs.readFileSync(path.join(contributionDir, "README.md"), "utf8");

    switch (category) {
      case "recipes":
        assert.ok(
          hasExtension(files, [".sql", ".ts", ".js", ".py"]) || (readme.match(/^\s*[0-9]+\./gim) || []).length >= 3,
          "recipes need code or at least three numbered README instructions",
        );
        break;
      case "schemas":
        assert.ok(hasExtension(files, [".sql"]), "schemas need a SQL file");
        break;
      case "dashboards":
        assert.ok(
          hasExtension(files, [".html", ".jsx", ".tsx", ".vue", ".svelte"]) ||
            files.some((file) => path.basename(file) === "package.json"),
          "dashboards need frontend code or package.json",
        );
        break;
      case "integrations":
        assert.ok(hasExtension(files, [".ts", ".js", ".py"]), "integrations need a code file");
        break;
      case "skills":
        assert.ok(
          files.some((file) => /(?:^|[.-])skill\.md$/i.test(path.basename(file))),
          "skills need a plain-text skill file",
        );
        break;
      case "primitives":
        assert.ok(readme.trim().split(/\s+/).length >= 200, "primitives need a README with at least 200 words");
        break;
      case "extensions":
        assert.ok(hasExtension(files, [".sql"]), "extensions need a SQL file");
        assert.ok(hasExtension(files, [".ts", ".js", ".py"]), "extensions need a code file");
        break;
    }
  }
});

test("primitive scaffold passes README completeness and internal-link requirements", (t) => {
  const root = repositoryFixture();
  cleanup(t, root);
  scaffold(root, answers({ category: "primitives", slug: "demo-primitive", name: "Demo Primitive" }));

  const contributionDir = path.join(root, "primitives", "demo-primitive");
  const readme = fs.readFileSync(path.join(contributionDir, "README.md"), "utf8");
  const relativeLinks = [...readme.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((link) => !link.startsWith("http") && !link.startsWith("#"));
  const brokenLinks = relativeLinks.filter((link) => {
    const [filePath] = link.split("#");
    return filePath && !fs.existsSync(path.resolve(contributionDir, filePath));
  });

  assert.match(readme, /^## Prerequisites$/m);
  assert.equal(readme.includes("../../extensions/extension-slug/"), false);
  assert.deepEqual(brokenLinks, []);
});

test("extension scaffold excludes the template-only agent specification", (t) => {
  const root = fixture();
  cleanup(t, root);
  fs.writeFileSync(path.join(root, "extensions", "_template", "AGENT_SPEC.md"), "Maintainer-only instructions.");

  scaffold(
    root,
    answers({ category: "extensions", slug: "demo-extension", name: "Demo Extension", learningOrder: 3 }),
  );

  assert.equal(fs.existsSync(path.join(root, "extensions", "demo-extension", "AGENT_SPEC.md")), false);
});

test("invalid CLI difficulty exits non-zero without writing anything", (t) => {
  const root = fixture();
  cleanup(t, root);
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--category",
      "recipes",
      "--slug",
      "invalid-demo",
      "--name",
      "Invalid Demo",
      "--description",
      "Invalid difficulty test.",
      "--author",
      "Test Author",
      "--difficulty",
      "expert",
      "--estimated-time",
      "10 minutes",
      "--tags",
      "demo",
      "--yes",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid difficulty/);
  assert.equal(fs.existsSync(path.join(root, "recipes", "invalid-demo")), false);
});

test("existing target exits 2 and remains untouched", (t) => {
  const root = fixture();
  cleanup(t, root);
  const target = path.join(root, "recipes", "demo-recipe");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "keep.txt"), "unchanged");

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--category",
      "recipes",
      "--slug",
      "demo-recipe",
      "--name",
      "Demo Recipe",
      "--description",
      "Existing target test.",
      "--author",
      "Test Author",
      "--difficulty",
      "beginner",
      "--estimated-time",
      "10 minutes",
      "--tags",
      "demo",
      "--yes",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "unchanged");
  assert.deepEqual(fs.readdirSync(target), ["keep.txt"]);
});

test("required skills are written to metadata and linked from README", (t) => {
  const root = fixture();
  cleanup(t, root);
  const result = scaffold(root, answers({ requiresSkills: "auto-capture,meeting-triage" }));
  const readme = fs.readFileSync(path.join(root, "recipes", "demo-recipe", "README.md"), "utf8");

  assert.deepEqual(result.metadata.requires_skills, ["auto-capture", "meeting-triage"]);
  assert.match(readme, /\.\.\/\.\.\/skills\/auto-capture\//);
  assert.match(readme, /\.\.\/\.\.\/skills\/meeting-triage\//);
});

test("CLI prints the validator as the next command when present", (t) => {
  const root = fixture();
  cleanup(t, root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "validate-contribution.mjs"), "");

  const output = execFileSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--category",
      "recipes",
      "--slug",
      "cli-demo",
      "--name",
      "CLI Demo",
      "--description",
      "CLI success test.",
      "--author",
      "Test Author",
      "--difficulty",
      "beginner",
      "--estimated-time",
      "10 minutes",
      "--tags",
      "demo",
      "--yes",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.match(output, /node scripts\/validate-contribution\.mjs recipes\/cli-demo/);
});

test("replacement tokens in user input are inserted literally", (t) => {
  const root = fixture();
  cleanup(t, root);
  scaffold(root, answers({ slug: "dollar-recipe", name: "Cash $& Carry", author: "A $` B" }));

  const readme = fs.readFileSync(path.join(root, "recipes", "dollar-recipe", "README.md"), "utf8");
  assert.match(readme, /# Cash \$& Carry/);
  assert.ok(!readme.includes("Recipe Name"));
});

test("dependency entries must be valid slugs", (t) => {
  const root = fixture();
  cleanup(t, root);

  assert.throws(
    () => scaffold(root, answers({ slug: "traversal-recipe", requiresSkills: ".." })),
    /Invalid --requires-skills entry/,
  );
  assert.ok(!fs.existsSync(path.join(root, "recipes", "traversal-recipe")));

  assert.throws(
    () => scaffold(root, answers({ slug: "traversal-primitive", requiresPrimitives: "../../etc" })),
    /Invalid --requires-primitives entry/,
  );

  const result = scaffold(root, answers({ slug: "valid-deps-recipe", requiresSkills: "auto-capture" }));
  assert.deepEqual(result.metadata.requires_skills, ["auto-capture"]);
});
