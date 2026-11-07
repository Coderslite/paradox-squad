import Link from "next/link";

const FEATURES = [
  { title: "Personal Rewind", body: "Snap back to where you were four seconds ago — position, health, ammo and all. Enemies see your afterimage." },
  { title: "Echoes", body: "Record eight seconds of your own play, then deploy a ghostly clone that replays it and fights beside you." },
  { title: "Era Shifts", body: "Every 90 seconds a temporal storm sweeps the arena from the Prehistoric jungle to a neon megacity." },
  { title: "No install", body: "Open a link, share a six-letter code and you are in. Runs at 60 FPS on a MacBook Air." },
];

const FAQ = [
  { q: "Is Paradox Squad free?", a: "Yes. It runs in your browser and there is nothing to download. Cosmetics never affect gameplay." },
  { q: "How do I play with friends?", a: "Create a private room and send the invite link (or the six-character code). Up to eight players per match, with bots filling empty slots." },
  { q: "What do I need to run it?", a: "A recent Chrome, Edge, Firefox or Safari with hardware acceleration. Graphics settings adjust automatically to your device." },
];

export default function Home() {
  return (
    <main>
      <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-6 text-center">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.18),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(249,115,22,0.12),transparent_55%)]" />
        <p className="relative font-mono text-xs uppercase tracking-[0.4em] text-cyan-300">Browser FPS · 2–8 players</p>
        <h1 className="relative mt-4 text-6xl font-black uppercase tracking-tight sm:text-8xl">Paradox Squad</h1>
        <p className="relative mt-6 max-w-xl text-lg text-white/70">History has fractured. Rewind yourself, fight beside your own echoes, and hold the line as eras collide mid-battle.</p>
        <div className="relative mt-10 flex gap-4">
          <Link href="/play" className="rounded-md bg-cyan-400 px-8 py-3 font-mono text-sm font-bold uppercase tracking-widest text-black transition hover:bg-cyan-300">
            Play now
          </Link>
          <a href="#features" className="rounded-md border border-white/20 px-8 py-3 font-mono text-sm uppercase tracking-widest text-white/80 transition hover:bg-white/10">
            Learn more
          </a>
        </div>
      </section>

      <section id="features" className="mx-auto grid max-w-5xl gap-6 px-6 py-20 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <article key={f.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-semibold">{f.title}</h2>
            <p className="mt-2 text-white/65">{f.body}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="mb-6 text-2xl font-bold">FAQ</h2>
        <dl className="space-y-5">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold">{f.q}</dt>
              <dd className="mt-1 text-white/65">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
