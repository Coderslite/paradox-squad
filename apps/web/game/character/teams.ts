/** Team accent colours (armour trim, visor) and relation rim colours. */
export const TEAM_COLORS = [0x3d8bff, 0xff7a2f, 0x8dff4a] as const;
export const ALLY_RIM = 0x3fb2ff;
export const ENEMY_RIM = 0xff3b30;

export const teamColor = (team: number): number => TEAM_COLORS[Math.max(0, Math.min(TEAM_COLORS.length - 1, team))]!;
