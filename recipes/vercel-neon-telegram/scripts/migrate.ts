import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

function splitStatements(sql: string): string[] {
  const results: string[] = [];
  let current = "";
  let inDollarQuote = false;

  const lines = sql.split("\n");
  for (const line of lines) {
    if (line.includes("$$")) {
      const count = (line.match(/\$\$/g) || []).length;
      if (count % 2 === 1) inDollarQuote = !inDollarQuote;
    }
    current += line + "\n";
    if (!inDollarQuote && line.trimEnd().endsWith(";")) {
      const trimmed = current.trim();
      if (trimmed && trimmed !== ";") results.push(trimmed);
      current = "";
    }
  }
  const remaining = current.trim();
  if (remaining && remaining !== ";") results.push(remaining);
  return results;
}

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const sqlDir = join(process.cwd(), "sql");
  const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    console.log(`Running ${file}...`);
    const content = readFileSync(join(sqlDir, file), "utf-8");
    // Neon HTTP driver can't run multiple statements at once — split on semicolons
    // but preserve $$ function bodies
    const statements = splitStatements(content);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    console.log(`  ✓ ${file}`);
  }

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
