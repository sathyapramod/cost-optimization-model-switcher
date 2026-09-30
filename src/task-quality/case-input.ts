import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskCase } from "./types.js";

const benchmarksRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "benchmarks");

/** Optional per-case source text at `benchmarks/assets/<caseId>.txt`. */
export function loadCaseInputText(taskCase: TaskCase, root = benchmarksRoot): string | undefined {
  const path = join(root, "assets", `${taskCase.id}.txt`);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trimEnd();
}

export function buildLiveUserPrompt(taskCase: TaskCase, inputText?: string): string {
  const body = inputText ?? loadCaseInputText(taskCase);
  const parts: string[] = [];
  if (body) {
    parts.push("--- SOURCE MATERIAL ---", body, "--- END SOURCE ---", "");
  } else if (taskCase.context?.description) {
    parts.push(`Context: ${taskCase.context.description}`, "");
  }
  if (taskCase.context?.assumptions?.length) {
    parts.push("Use or explicitly challenge these assumptions:");
    for (const a of taskCase.context.assumptions) parts.push(`- ${a}`);
    parts.push("");
  }
  parts.push(taskCase.userMessage);
  return parts.join("\n");
}
