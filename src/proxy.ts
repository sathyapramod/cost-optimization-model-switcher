#!/usr/bin/env node
import { createServer } from "node:http";
import { evaluateGate } from "./gate.js";
import { handleSuggestModelSwitch } from "./tool-schema.js";
import type { ContextProbe, GateInput, SuggestModelSwitchInput } from "./types.js";

const PORT = Number(process.env.PORT ?? 8787);
const AUTO_SWITCH = process.env.AUTO_SWITCH === "1";

function readJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/v1/gate") {
      const body = await readJson<GateInput>(req);
      return send(res, 200, evaluateGate(body));
    }

    if (req.method === "POST" && req.url === "/v1/suggest_model_switch") {
      const body = await readJson<SuggestModelSwitchInput>(req);
      const result = await handleSuggestModelSwitch(body, {
        autoSwitchEnabled: AUTO_SWITCH,
        onSwitch: async (input) => {
          if (!AUTO_SWITCH) {
            return {
              status: "unavailable",
              switched_to: null,
              message:
                "Proxy awaiting user confirmation. Set AUTO_SWITCH=1 to auto-accept in dev.",
            };
          }
          const target = input.recommended_model_id ?? input.recommended_model;
          return {
            status: "accepted",
            switched_to: target,
            message: `Switched to ${target}.`,
          };
        },
      });
      return send(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/v1/probe/github_pr") {
      const body = await readJson<{
        additions: number;
        deletions: number;
        changedFiles: number;
        refs?: string[];
      }>(req);
      const probe: ContextProbe = {
        source: "github_pr",
        additions: body.additions,
        deletions: body.deletions,
        changedFiles: body.changedFiles,
        refs: body.refs,
      };
      return send(res, 200, { probe });
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(PORT, () => {
  console.log(`cost-gate proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`AUTO_SWITCH=${AUTO_SWITCH ? "1" : "0"}`);
});
