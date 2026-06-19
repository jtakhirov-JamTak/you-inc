export function readFirstName(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const raw = metadata?.first_name;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.slice(0, 50);
}
