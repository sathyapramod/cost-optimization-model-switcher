import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadDefaultCatalog, resolveModel } from "../catalog.js";

describe("resolveModel", () => {
  const catalog = loadDefaultCatalog();

  it("resolves Anthropic models", () => {
    const r = resolveModel("claude-opus-4-6", catalog);
    assert.equal(r.provider, "anthropic");
    assert.equal(r.tier, "premium");
    assert.equal(r.matched, true);
  });

  it("resolves OpenAI models", () => {
    const r = resolveModel("gpt-4o-mini", catalog);
    assert.equal(r.provider, "openai");
    assert.equal(r.tier, "fast");
  });

  it("resolves OpenAI reasoning models", () => {
    const r = resolveModel("o3", catalog);
    assert.equal(r.provider, "openai");
    assert.equal(r.tier, "premium");
  });

  it("resolves Cursor composer models", () => {
    const r = resolveModel("composer-2.5", catalog);
    assert.equal(r.provider, "cursor");
    assert.equal(r.tier, "premium");
  });

  it("respects provider hint for shared model ids", () => {
    const r = resolveModel("gpt-4o-mini", catalog, "cursor");
    assert.equal(r.provider, "cursor");
    assert.equal(r.tier, "fast");
  });
});
