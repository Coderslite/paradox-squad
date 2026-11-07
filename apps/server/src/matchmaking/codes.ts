import { matchMaker } from "@colyseus/core";
import { generateInviteCode } from "@paradox/shared";

/** A 6-character invite code not used by any live room. The code doubles as the room id. */
export async function uniqueRoomCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateInviteCode();
    const existing = await matchMaker.query({ roomId: code });
    if (existing.length === 0) return code;
  }
  throw new Error("Could not allocate a unique room code");
}
