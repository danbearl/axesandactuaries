// Shared "Xh Ym" / "Ym" duration formatter — previously duplicated inline across
// InjuryStatus/RestStatus (AdventurerDetail.tsx) and DeployByCountdown.tsx.
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
