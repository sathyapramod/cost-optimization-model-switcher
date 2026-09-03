import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SuggestModelSwitchInput, SuggestModelSwitchResult } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "schemas", "suggest_model_switch.json");

export const SUGGEST_MODEL_SWITCH_TOOL = JSON.parse(
  readFileSync(schemaPath, "utf8"),
) as {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export interface ModelSwitchHandlerOptions {
  /** When true, accept without user prompt */
  autoSwitchEnabled?: boolean;
  /** Inject host-specific switch logic */
  onSwitch?: (input: SuggestModelSwitchInput) => Promise<SuggestModelSwitchResult>;
}

const defaultOnSwitch = async (
  input: SuggestModelSwitchInput,
): Promise<SuggestModelSwitchResult> => {
  const target = input.recommended_model_id ?? input.recommended_model;
  if (input.auto_switch) {
    return {
      status: "accepted",
      switched_to: target,
      message: `Auto-switched to ${target}. Continue with scoped ingest.`,
    };
  }
  return {
    status: "unavailable",
    switched_to: null,
    message:
      "No host UI configured. Present confirmation to the user or enable auto_switch.",
  };
};

export async function handleSuggestModelSwitch(
  input: SuggestModelSwitchInput,
  options: ModelSwitchHandlerOptions = {},
): Promise<SuggestModelSwitchResult> {
  if (input.task_class !== "straightforward") {
    return {
      status: "declined",
      switched_to: null,
      message: "Model switch declined: task classified as complex.",
    };
  }

  const handler = options.onSwitch ?? defaultOnSwitch;
  const merged: SuggestModelSwitchInput = {
    ...input,
    auto_switch: input.auto_switch ?? options.autoSwitchEnabled ?? false,
    preserve_context: input.preserve_context ?? true,
  };

  return handler(merged);
}
