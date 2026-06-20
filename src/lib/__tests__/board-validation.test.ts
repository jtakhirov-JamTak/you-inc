// Board authoring request schemas. These gate user-authored note/resolution text
// at the endpoint boundary — pin the bounds (empty/oversized text, bad UUIDs) so a
// loosened schema can't silently let malformed writes through to the RLS client.

import { describe, it, expect } from "vitest";
import {
  boardNoteSchema,
  boardResolutionAddSchema,
  boardResolutionToggleSchema,
  boardResolutionDeleteSchema,
} from "@/lib/validation";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("boardNoteSchema", () => {
  it("accepts a note within the length cap (incl. empty = clear)", () => {
    expect(boardNoteSchema.safeParse({ meetingId: UUID, note: "" }).success).toBe(true);
    expect(boardNoteSchema.safeParse({ meetingId: UUID, note: "good week" }).success).toBe(true);
  });

  it("rejects a non-uuid meetingId and an oversized note", () => {
    expect(boardNoteSchema.safeParse({ meetingId: "nope", note: "x" }).success).toBe(false);
    expect(
      boardNoteSchema.safeParse({ meetingId: UUID, note: "x".repeat(801) }).success,
    ).toBe(false);
  });
});

describe("boardResolutionAddSchema", () => {
  it("accepts trimmed non-empty text and trims surrounding whitespace", () => {
    const parsed = boardResolutionAddSchema.safeParse({ meetingId: UUID, text: "  walk daily  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.text).toBe("walk daily");
  });

  it("rejects empty/whitespace-only and oversized text", () => {
    expect(boardResolutionAddSchema.safeParse({ meetingId: UUID, text: "   " }).success).toBe(false);
    expect(
      boardResolutionAddSchema.safeParse({ meetingId: UUID, text: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("boardResolution toggle / delete", () => {
  it("requires a boolean checked and uuid ids", () => {
    expect(
      boardResolutionToggleSchema.safeParse({ resolutionId: UUID, checked: true }).success,
    ).toBe(true);
    expect(
      boardResolutionToggleSchema.safeParse({ resolutionId: UUID, checked: "yes" }).success,
    ).toBe(false);
    expect(boardResolutionDeleteSchema.safeParse({ resolutionId: UUID }).success).toBe(true);
    expect(boardResolutionDeleteSchema.safeParse({ resolutionId: "x" }).success).toBe(false);
  });
});
