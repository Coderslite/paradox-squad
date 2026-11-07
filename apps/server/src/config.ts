/** Server configuration from environment variables (documented in .env.example). */
export const config = {
  port: Number(process.env.PORT ?? 2567),
  /** Region label shown in the browser and used by quick play (e.g. "eu-central"). */
  region: process.env.REGION ?? "eu-central",
  /** Simulated round-trip latency (ms) for local netcode testing. 0 = off. */
  simulatedLatencyMs: Number(process.env.SIMULATED_LATENCY_MS ?? 0),
  /** Test harness only: damage is reported but never kills. Never set in production. */
  testNoDeath: process.env.PARADOX_TEST_MODE === "1",
} as const;
