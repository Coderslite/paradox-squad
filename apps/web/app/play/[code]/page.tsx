import type { Metadata } from "next";
import { Suspense } from "react";
import { OnlineClient } from "./OnlineClient";

export const metadata: Metadata = {
  title: "Match",
  description: "You've been invited to a Paradox Squad match. Open the link to join instantly in your browser.",
  robots: { index: false },
};

export default function MatchPage({ params }: PageProps<"/play/[code]">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#05070a]" />}>
      {params.then(({ code }) => (
        <OnlineClient code={code} />
      ))}
    </Suspense>
  );
}
