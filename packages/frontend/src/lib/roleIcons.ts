import { VOCATION_PARTY_ROLE, type Vocation, type PartyRole } from '@axes-actuaries/types';

// Same icon set used in ContractCard.tsx's per-encounter role-modifier display — shared here
// so every place a vocation is shown (roster, adventurer profile, assign-party dialogs) uses
// the identical glyph, making the fighter/wizard/rogue/priest grouping visually consistent
// with how contracts express their own role preferences.
export const ROLE_ICONS: Record<PartyRole, string> = {
  fighter: '⚔',
  wizard:  '🔮',
  rogue:   '🗡',
  priest:  '✚',
};

// Loose `string` param (not the narrower Vocation type) so every call site — Adventurer,
// AdventurerResponse, and ad-hoc { vocation: string } shapes alike — can pass its field
// straight through without a cast, matching how countUnmetRequirements/adventurerMeetsAny
// Requirement already treat vocation as a plain string for the same reason.
export function vocationIcon(vocation: string): string {
  const role = VOCATION_PARTY_ROLE[vocation as Vocation];
  return role ? ROLE_ICONS[role] : '';
}
