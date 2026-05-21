export type ActiveInvite = {
  id: string;
  label: string | null;
  role: "admin" | "member";
  groupIds: string[];
  groupNames: string[];
  createdBy: { id: string; displayName: string | null };
  createdAt: string;
  expiresAt: string;
  token: string | null;
  joinUrl: string | null;
  redemptionCount: number;
};

export function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "today";
  if (days === 1) return "in 1d";
  return `in ${days}d`;
}
