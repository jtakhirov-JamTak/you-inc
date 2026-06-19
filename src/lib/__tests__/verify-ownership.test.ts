// Cross-account guard. verifyPersonOwnership backs every Coach submission that
// accepts a client-provided personId — if it ever returned true for another
// user's person, a crafted request could link an entry (and its coaching) to a
// stranger's person row. Pins true-on-found / false-on-missing AND that the
// query is scoped by user_id + is_active, not person_id alone.

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyPersonOwnership } from "@/lib/verify-ownership";

type EqCall = [string, unknown];

// Records every .eq() filter so we can assert the ownership + active scoping.
function fakeClient(found: boolean) {
  const eqCalls: EqCall[] = [];
  let fromTable: string | null = null;
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve({ data: found ? { person_id: "p-1" } : null }),
  };
  const client = {
    from: (table: string) => {
      fromTable = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, eqCalls, table: () => fromTable };
}

describe("verifyPersonOwnership", () => {
  it("returns true when a matching active person row exists", async () => {
    const { client } = fakeClient(true);
    expect(await verifyPersonOwnership(client, "user-1", "p-1")).toBe(true);
  });

  it("returns false when no matching row exists (wrong owner / inactive / absent)", async () => {
    const { client } = fakeClient(false);
    expect(await verifyPersonOwnership(client, "user-1", "p-1")).toBe(false);
  });

  it("scopes the query by person_id, user_id, and is_active=true", async () => {
    const { client, eqCalls, table } = fakeClient(true);
    await verifyPersonOwnership(client, "user-1", "p-1");
    expect(table()).toBe("persons");
    expect(eqCalls).toEqual([
      ["person_id", "p-1"],
      ["user_id", "user-1"],
      ["is_active", true],
    ]);
  });
});
