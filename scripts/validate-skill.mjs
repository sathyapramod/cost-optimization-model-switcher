import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(root, "SKILL.md");
const schemaPath = join(root, "schemas", "suggest_model_switch.json");

const content = readFileSync(skillPath, "utf8");
if (!content.startsWith("---")) {
  console.error("SKILL.md: missing YAML frontmatter");
  process.exit(1);
}

const match = content.match(/^---\n([\s\S]*?)\n---/);
if (!match) {
  console.error("SKILL.md: invalid frontmatter");
  process.exit(1);
}

const frontmatter = match[1];
for (const key of ["name:", "description:"]) {
  if (!frontmatter.includes(key)) {
    console.error(`SKILL.md: missing ${key}`);
    process.exit(1);
  }
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
if (schema.name !== "suggest_model_switch") {
  console.error("schema: unexpected tool name");
  process.exit(1);
}

console.log("skill + schema validation OK");
