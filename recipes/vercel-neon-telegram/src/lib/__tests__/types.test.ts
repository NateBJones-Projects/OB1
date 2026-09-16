import { describe, it, expect } from "vitest";
import { metadataSchema, thoughtTypeEnum } from "../types";

describe("thoughtTypeEnum", () => {
  const validTypes = [
    "observation",
    "task",
    "idea",
    "reference",
    "person_note",
    "decision",
    "meeting_note",
  ];

  it.each(validTypes)("accepts '%s'", (type) => {
    expect(thoughtTypeEnum.parse(type)).toBe(type);
  });

  it("rejects invalid type", () => {
    expect(() => thoughtTypeEnum.parse("invalid")).toThrow();
  });
});

describe("metadataSchema", () => {
  it("parses complete metadata", () => {
    const input = {
      people: ["Alice", "Bob"],
      action_items: ["Review PR"],
      dates_mentioned: ["2026-03-14"],
      topics: ["engineering", "review"],
      type: "task",
    };
    const result = metadataSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("applies defaults for missing fields", () => {
    const result = metadataSchema.parse({});
    expect(result).toEqual({
      people: [],
      action_items: [],
      dates_mentioned: [],
      topics: [],
      type: "observation",
    });
  });

  it("rejects more than 3 topics", () => {
    expect(() =>
      metadataSchema.parse({
        topics: ["a", "b", "c", "d"],
      }),
    ).toThrow();
  });

  it("allows 0-3 topics", () => {
    expect(metadataSchema.parse({ topics: [] }).topics).toHaveLength(0);
    expect(metadataSchema.parse({ topics: ["a"] }).topics).toHaveLength(1);
    expect(
      metadataSchema.parse({ topics: ["a", "b", "c"] }).topics,
    ).toHaveLength(3);
  });
});
