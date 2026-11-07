/** Unambiguous alphabet: no 0/O, 1/I/L. 31^6 ≈ 887M codes. */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_LENGTH = 6;
const INVITE_RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`);

/** Generates a room invite code using a cryptographically secure source by default. */
export function generateInviteCode(randomUint32: () => number = secureRandomUint32): string {
  let code = "";
  for (let i = 0; i < INVITE_LENGTH; i++) {
    code += INVITE_ALPHABET[randomUint32() % INVITE_ALPHABET.length];
  }
  return code;
}

/** Uppercases and strips separators users commonly paste ("abc-123" → "ABC123"). */
export const normalizeInviteCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const isValidInviteCode = (code: string): boolean => INVITE_RE.test(code);

function secureRandomUint32(): number {
  const buf = new Uint32Array(1);
  // Web Crypto exists in browsers and Node 20+; typed locally so shared code needs no DOM lib.
  (globalThis as unknown as { crypto: { getRandomValues(a: Uint32Array): Uint32Array } }).crypto.getRandomValues(buf);
  return buf[0] as number;
}
