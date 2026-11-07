import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { initPhysics } from "@paradox/shared";
import { initNavigation } from "./ai/navmesh";
import { config } from "./config";
import { TdmRoom } from "./rooms/TdmRoom";

async function main(): Promise<void> {
  await Promise.all([initPhysics(), initNavigation()]);

  const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 4 });
  const server = new Server({ transport, greet: false });
  // Private rooms are created with { private: true }; quick play only matches public rooms.
  server.define("tdm", TdmRoom);

  if (config.simulatedLatencyMs > 0) {
    server.simulateLatency(config.simulatedLatencyMs);
    console.log(`[paradox] simulating ${config.simulatedLatencyMs}ms round-trip latency`);
  }

  await server.listen(config.port);
  console.log(`[paradox] game server listening on :${config.port} (region ${config.region})`);

  const shutdown = async (): Promise<void> => {
    await server.gracefullyShutdown(false);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
