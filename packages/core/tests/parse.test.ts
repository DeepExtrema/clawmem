// #57: Unit tests for parseLLMJson and entity/extraction parsers
import { describe, it, expect } from "vitest";
import { parseLLMJson } from "../src/utils/parse-llm-json.js";
import { parseEntityExtractionResponse } from "../src/prompts/entity-extraction.js";
import { parseExtractionResponse } from "../src/prompts/extraction.js";
import { parseBullets } from "../src/utils/parse-bullets.js";

describe("parseLLMJson", () => {
  it("parses valid JSON", () => {
    expect(parseLLMJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseLLMJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("strips <think> prefix", () => {
    expect(parseLLMJson('<think>reasoning here</think>{"a": 1}')).toEqual({ a: 1 });
  });

  it("returns null for garbage", () => {
    expect(parseLLMJson("not json at all")).toBeNull();
  });

  it("extracts JSON from mixed text", () => {
    expect(parseLLMJson('Here is the result: {"a": 1}')).toEqual({ a: 1 });
  });

  it("returns null for empty string", () => {
    expect(parseLLMJson("")).toBeNull();
  });
});

describe("parseEntityExtractionResponse", () => {
  it("parses valid entities and relations", () => {
    const raw = JSON.stringify({
      entities: [{ name: "Alice", type: "person" }],
      relations: [{ source: "Alice", relationship: "knows", target: "Bob" }],
    });
    const result = parseEntityExtractionResponse(raw);
    expect(result.entities).toHaveLength(1);
    expect(result.relations).toHaveLength(1);
  });

  it("filters invalid entities (missing name)", () => {
    const raw = JSON.stringify({
      entities: [{ type: "person" }, { name: "Bob", type: "person" }],
      relations: [],
    });
    const result = parseEntityExtractionResponse(raw);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.name).toBe("Bob");
  });

  it("filters invalid relations (missing target)", () => {
    const raw = JSON.stringify({
      entities: [],
      relations: [
        { source: "A", relationship: "knows" },
        { source: "A", relationship: "knows", target: "B" },
      ],
    });
    const result = parseEntityExtractionResponse(raw);
    expect(result.relations).toHaveLength(1);
  });

  it("returns empty for malformed input", () => {
    const result = parseEntityExtractionResponse("not json");
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });
});

describe("parseExtractionResponse", () => {
  it("parses valid memories array", () => {
    const raw = JSON.stringify({
      memories: [
        { memory: "likes coffee", category: "preferences", memoryType: "preference" },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.memory).toBe("likes coffee");
  });

  it("normalizes unknown category to 'other'", () => {
    const raw = JSON.stringify({
      memories: [
        { memory: "test", category: "INVALID_CAT", memoryType: "fact" },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe("other");
  });

  it("normalizes unknown memoryType to 'fact'", () => {
    const raw = JSON.stringify({
      memories: [
        { memory: "test", category: "other", memoryType: "INVALID_TYPE" },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.memoryType).toBe("fact");
  });

  it("filters out items with empty memory string", () => {
    const raw = JSON.stringify({
      memories: [
        { memory: "", category: "other", memoryType: "fact" },
        { memory: "valid", category: "other", memoryType: "fact" },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for garbage", () => {
    expect(parseExtractionResponse("garbage")).toEqual([]);
  });
});

// #43: parseBullets unit tests
describe("parseBullets", () => {
  it("extracts dash bullets", () => {
    const md = "# Title\n- First bullet point here\n- Second bullet point here";
    const result = parseBullets(md);
    expect(result).toEqual(["First bullet point here", "Second bullet point here"]);
  });

  it("extracts asterisk bullets", () => {
    const md = "* Asterisk bullet item";
    expect(parseBullets(md)).toEqual(["Asterisk bullet item"]);
  });

  it("strips <!-- id:... --> comments", () => {
    const md = "- User likes coffee <!-- id:abc123 -->";
    expect(parseBullets(md)).toEqual(["User likes coffee"]);
  });

  it("strips *(type)* suffixes", () => {
    const md = "- User likes coffee *(fact)*";
    expect(parseBullets(md)).toEqual(["User likes coffee"]);
  });

  it("filters lines shorter than 6 chars", () => {
    const md = "- Hi\n- This is a longer bullet";
    expect(parseBullets(md)).toEqual(["This is a longer bullet"]);
  });

  it("returns empty for content with no bullets", () => {
    expect(parseBullets("# Just a heading\nSome text")).toEqual([]);
  });

  it("handles empty string", () => {
    expect(parseBullets("")).toEqual([]);
  });
});
