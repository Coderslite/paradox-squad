"use client";

import dynamic from "next/dynamic";

// The play screen touches WebGL/pointer-lock APIs on first render: never server-render it.
const PlayScreen = dynamic(() => import("@/components/game/PlayScreen").then((m) => m.PlayScreen), { ssr: false });

export function PracticeClient() {
  return <PlayScreen net={null} title="Practice Range" subtitle="Foundry greybox · target dummies respawn after 2.5s" />;
}
