import type { CSSProperties, ReactNode } from 'react'
import Image from 'next/image'
import {
  ArrowRight,
  Camera,
  Landmark,
  Languages,
  Store,
  Wand2,
} from 'lucide-react'

export const metadata = {
  title: 'Screenshot Section Preview - Internal',
  robots: { index: false, follow: false },
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const NB = '/images/landing/nano-banana'
const SO = '/images/landing/screenshot-options'

type Pair = { app: string; title: string; raw: string; out: string }

const pairs = {
  gymlevelsXp: { app: 'GymLevels', title: 'Rank up your workouts', raw: `${NB}/gymlevels-xp-raw.png`, out: `${NB}/gymlevels-xp-marketing.jpg` },
  gymlevelsMuscle: { app: 'GymLevels', title: 'Muscle coverage map', raw: `${NB}/gymlevels-muscle-raw.png`, out: `${NB}/gymlevels-muscle-marketing.jpg` },
  gymstreakAi: { app: 'GymStreak', title: 'Personal training plans', raw: `${NB}/gymstreak-ai-raw.png`, out: `${NB}/gymstreak-ai-marketing.jpg` },
  gymstreakProgress: { app: 'GymStreak', title: 'Progress at a glance', raw: `${NB}/gymstreak-progress-raw.png`, out: `${NB}/gymstreak-progress-marketing.jpg` },
  snoozyPredict: { app: 'SnoozyBear', title: 'Know tonight before tonight', raw: `${NB}/snoozybear-predict-raw.jpg`, out: `${NB}/snoozybear-predict-marketing.jpg` },
  snoozySounds: { app: 'SnoozyBear', title: 'Soothe with sounds', raw: `${NB}/snoozybear-sounds-raw.jpg`, out: `${NB}/snoozybear-sounds-marketing.jpg` },
  snoozyWeekly: { app: 'SnoozyBear', title: 'Weekly sleep review', raw: `${NB}/snoozybear-weekly-raw.jpg`, out: `${NB}/snoozybear-weekly-marketing.jpg` },
  threadcam: { app: 'ThreadCam', title: 'Pro mockups from one photo', raw: `${SO}/threadcam-ai-studio-raw.png`, out: `${SO}/threadcam-pro-mockups-generated.jpg` },
  storycrest: { app: 'StoryCrest', title: 'Photos become storybooks', raw: `${SO}/storycrest-photo-book-raw.png`, out: `${SO}/storycrest-photo-magic-generated.png` },
  thriftgenius: { app: 'ThriftGenius', title: 'Spot resale value fast', raw: `${SO}/thriftgenius-resale-raw.png`, out: `${SO}/thriftgenius-value-generated.png` },
  shotwise: { app: 'Shotwise', title: 'Every shot, logged', raw: `${SO}/shotwise-history-raw.png`, out: `${SO}/shotwise-shot-log-generated.png` },
} satisfies Record<string, Pair>

const allPairs: Pair[] = [
  pairs.gymstreakAi,
  pairs.gymlevelsXp,
  pairs.snoozyPredict,
  pairs.gymstreakProgress,
  pairs.gymlevelsMuscle,
  pairs.snoozySounds,
  pairs.snoozyWeekly,
]

const launchCycle: Pair[] = [
  { app: 'SnoozyBear', title: 'Start Tracking Sleep', raw: '/images/landing/applistingagent-screenshots/before-snoozybear-9e450186.jpg', out: '/images/landing/applistingagent-screenshots/after-snoozybear-9e450186.jpg' },
  { app: 'SnoozyBear', title: 'Predict Nap Times', raw: '/images/landing/applistingagent-screenshots/before-snoozybear-0de00879.jpg', out: '/images/landing/applistingagent-screenshots/after-snoozybear-0de00879.jpg' },
  { app: 'SnoozyBear', title: 'Understand Nap Timing', raw: '/images/landing/applistingagent-screenshots/before-snoozybear-cc6264cd.jpg', out: '/images/landing/applistingagent-screenshots/after-snoozybear-cc6264cd.jpg' },
  { app: 'SnoozyBear', title: 'Soothe With Sounds', raw: '/images/landing/applistingagent-screenshots/before-snoozybear-ca338363.jpg', out: '/images/landing/applistingagent-screenshots/after-snoozybear-ca338363.jpg' },
  { app: 'SnoozyBear', title: 'Track Weekly Progress', raw: '/images/landing/applistingagent-screenshots/before-snoozybear-3e12e1b2.jpg', out: '/images/landing/applistingagent-screenshots/after-snoozybear-3e12e1b2.jpg' },
]

const galleryWall: Pair[] = [
  { app: 'Health Wrapped', title: 'Weekly Health Wrapped', raw: '/images/landing/applistingagent-screenshots/health-wrapped-app-iphone-69-fe866b9b.jpg', out: '/images/landing/applistingagent-screenshots/health-wrapped-app-iphone-69-fe866b9b.jpg' },
  { app: 'Mendora', title: 'Stop Contacting Your Ex', raw: '/images/landing/applistingagent-screenshots/mendora-app-iphone-69-fce7145c.jpg', out: '/images/landing/applistingagent-screenshots/mendora-app-iphone-69-fce7145c.jpg' },
  { app: 'NoEnemies', title: 'Turn conflict into daily peace practice', raw: '/images/landing/applistingagent-screenshots/noenemies-app-iphone-69-3a27df55.png', out: '/images/landing/applistingagent-screenshots/noenemies-app-iphone-69-3a27df55.png' },
  { app: 'PepMod', title: 'Your peptide protocol, organised.', raw: '/images/landing/applistingagent-screenshots/pepmod-app-iphone-69-f2ddcd54.jpg', out: '/images/landing/applistingagent-screenshots/pepmod-app-iphone-69-f2ddcd54.jpg' },
  { app: 'PrayLock', title: 'Pray first. Then unlock.', raw: '/images/landing/applistingagent-screenshots/praylock-app-iphone-69-a265ab7f.jpg', out: '/images/landing/applistingagent-screenshots/praylock-app-iphone-69-a265ab7f.jpg' },
  { app: 'ThreadCam', title: 'ThreadCam', raw: '/images/landing/applistingagent-screenshots/threadcam-app-iphone-69-80f7b1c2.jpg', out: '/images/landing/applistingagent-screenshots/threadcam-app-iphone-69-80f7b1c2.jpg' },
  { app: 'SleepLog', title: 'Hard mode for heavy sleepers', raw: '/images/landing/applistingagent-screenshots/sleeplog-app-iphone-69-02076160.jpg', out: '/images/landing/applistingagent-screenshots/sleeplog-app-iphone-69-02076160.jpg' },
  { app: 'Photo to PDF Scanner', title: 'Photo to PDF Scanner', raw: '/images/landing/applistingagent-screenshots/photo-to-pdf-scanner-app-iphone-65-7b3041b9.jpg', out: '/images/landing/applistingagent-screenshots/photo-to-pdf-scanner-app-iphone-65-7b3041b9.jpg' },
  { app: 'GymStreak', title: 'YOUR AI PERSONAL TRAINER', raw: '/images/landing/applistingagent-screenshots/gymstreak-app-iphone-69-03c5ab5b.jpg', out: '/images/landing/applistingagent-screenshots/gymstreak-app-iphone-69-03c5ab5b.jpg' },
  { app: 'LoadScore', title: "Know Your Body's Weather", raw: '/images/landing/applistingagent-screenshots/loadscore-app-iphone-69-60ed82df.jpg', out: '/images/landing/applistingagent-screenshots/loadscore-app-iphone-69-60ed82df.jpg' },
  { app: 'GymLevels', title: 'The Gym, Gamified', raw: '/images/landing/applistingagent-screenshots/gymlevels-app-iphone-65-5477be12.jpg', out: '/images/landing/applistingagent-screenshots/gymlevels-app-iphone-65-5477be12.jpg' },
  { app: 'Bare Minimum', title: 'The Fitness App for People Who Hate Fitness.', raw: '/images/landing/applistingagent-screenshots/bare-minimum-workouts-app-iphone-69-7da34e6e.jpg', out: '/images/landing/applistingagent-screenshots/bare-minimum-workouts-app-iphone-69-7da34e6e.jpg' },
  { app: 'FlexBod', title: 'YOUR PERSONAL STRETCH COACH', raw: '/images/landing/applistingagent-screenshots/flexbod-app-iphone-69-90b3c9c6.jpg', out: '/images/landing/applistingagent-screenshots/flexbod-app-iphone-69-90b3c9c6.jpg' },
  { app: 'SnoozyBear', title: 'Start Tracking Sleep', raw: '/images/landing/applistingagent-screenshots/snoozybear-app-iphone-69-68b40b5a.jpg', out: '/images/landing/applistingagent-screenshots/snoozybear-app-iphone-69-68b40b5a.jpg' },
  { app: 'BabyRelay', title: 'One shared log for every caregiver.', raw: '/images/landing/applistingagent-screenshots/babyrelay-app-iphone-69-60ee838a.jpg', out: '/images/landing/applistingagent-screenshots/babyrelay-app-iphone-69-60ee838a.jpg' },
  { app: 'OvaKind', title: 'PCOS tracking for irregular cycles', raw: '/images/landing/applistingagent-screenshots/ovakind-app-iphone-69-f119ba53.jpg', out: '/images/landing/applistingagent-screenshots/ovakind-app-iphone-69-f119ba53.jpg' },
  { app: 'PixelShift', title: 'Edit photos with words.', raw: '/images/landing/applistingagent-screenshots/pixelshift-app-iphone-69-8a014714.jpg', out: '/images/landing/applistingagent-screenshots/pixelshift-app-iphone-69-8a014714.jpg' },
  { app: 'GLP 1 Tracker', title: 'GLP-1 TRACKER', raw: '/images/landing/applistingagent-screenshots/glp-1-tracker-app-iphone-69-613bd251.jpg', out: '/images/landing/applistingagent-screenshots/glp-1-tracker-app-iphone-69-613bd251.jpg' },
]

const galleryAspects = [
  'aspect-[9/16]',
  'aspect-[9/19]',
  'aspect-[4/5]',
  'aspect-[9/17]',
  'aspect-[3/4]',
]

const appChipStyles: Record<string, string> = {
  GymLevels: 'border-amber-400/25 bg-amber-500/15 text-amber-200',
  GymStreak: 'border-blue-400/25 bg-blue-500/15 text-blue-200',
  SnoozyBear: 'border-violet-400/25 bg-violet-500/15 text-violet-200',
  ThreadCam: 'border-pink-400/25 bg-pink-500/15 text-pink-200',
  StoryCrest: 'border-emerald-400/25 bg-emerald-500/15 text-emerald-200',
  ThriftGenius: 'border-orange-400/25 bg-orange-500/15 text-orange-200',
  Shotwise: 'border-cyan-400/25 bg-cyan-500/15 text-cyan-200',
  'Health Wrapped': 'border-lime-400/25 bg-lime-500/15 text-lime-100',
  Mendora: 'border-rose-400/25 bg-rose-500/15 text-rose-100',
  NoEnemies: 'border-teal-400/25 bg-teal-500/15 text-teal-100',
  PepMod: 'border-sky-400/25 bg-sky-500/15 text-sky-100',
  PrayLock: 'border-yellow-400/25 bg-yellow-500/15 text-yellow-100',
  SleepLog: 'border-orange-300/25 bg-orange-500/15 text-orange-100',
  'Photo to PDF Scanner': 'border-indigo-400/25 bg-indigo-500/15 text-indigo-100',
  LoadScore: 'border-green-400/25 bg-green-500/15 text-green-100',
  'Bare Minimum': 'border-emerald-400/25 bg-emerald-500/15 text-emerald-100',
  FlexBod: 'border-green-400/25 bg-green-500/15 text-green-100',
  BabyRelay: 'border-amber-400/25 bg-amber-500/15 text-amber-100',
  OvaKind: 'border-pink-400/25 bg-pink-500/15 text-pink-100',
  PixelShift: 'border-cyan-400/25 bg-cyan-500/15 text-cyan-100',
  'GLP 1 Tracker': 'border-blue-400/25 bg-blue-500/15 text-blue-100',
}

function AppChip({ app, className = '' }: { app: string; className?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${appChipStyles[app] ?? 'border-white/15 bg-white/10 text-white/80'} ${className}`}>
      {app}
    </span>
  )
}

function VariantHeader({
  n,
  accent,
  kicker,
  title,
  subtitle,
  dark = true,
}: {
  n: number
  accent: string
  kicker: string
  title: string
  subtitle: string
  dark?: boolean
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-[12px] font-bold uppercase tracking-[0.18em] ${accent}`}>
        Variant {n} · {kicker}
      </div>
      <h2 className="text-3xl font-bold tracking-tight md:text-5xl">{title}</h2>
      <p className={`mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed md:text-[17px] ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>
        {subtitle}
      </p>
    </div>
  )
}

function Verdict({ accent, text, dark = true }: { accent: string; text: string; dark?: boolean }) {
  return (
    <p className={`mx-auto mt-14 max-w-2xl border-t pt-6 text-center text-[13px] leading-relaxed ${dark ? 'border-white/[0.06] text-neutral-500' : 'border-black/10 text-neutral-600'}`}>
      <span className={`font-bold uppercase tracking-[0.18em] ${accent}`}>Read: </span>
      {text}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Cycle stack - stacks N layers; each layer animates itself via keyframes that
// keep exactly one layer visible at a time (visible window = first 20% of the
// cycle, offset by animation-delay). First layer sits in normal flow so the
// container keeps its height; it also carries .cycle-first so reduced-motion
// users see a static first pair instead of an empty box.
// ---------------------------------------------------------------------------

function CycleStack({
  items,
  className = '',
  render,
}: {
  items: Pair[]
  className?: string
  render: (p: Pair, i: number) => ReactNode
}) {
  return (
    <div className={`relative ${className}`}>
      {items.map((p, i) => (
        <div key={`${p.out}-${i}`} className={i === 0 ? 'cycle-first relative' : 'absolute inset-0'}>
          {render(p, i)}
        </div>
      ))}
    </div>
  )
}

function cycleDelay(i: number, segment: number) {
  return `${-(i * segment)}s`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScreenshotOptionsPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white selection:bg-purple-500/30 selection:text-purple-200">
      <style>{`
        /* One-of-five cycling: each layer is visible for the first ~20% of the
           loop; layers are offset with animation-delay to take turns. */
        @keyframes cycle-fade {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          19.5% { opacity: 1; transform: translateY(0) scale(1); }
          19.6% { opacity: 0; transform: translateY(-8px) scale(0.995); }
          100% { opacity: 0; transform: translateY(-8px) scale(0.995); }
        }
        @keyframes cycle-cut {
          0% { opacity: 1; }
          19.5% { opacity: 1; }
          19.6% { opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes slide-raw {
          0% { opacity: 1; transform: translateX(0) rotate(0deg); }
          19.5% { opacity: 1; transform: translateX(0) rotate(0deg); }
          19.6% { opacity: 0; transform: translateX(12px) rotate(0deg); }
          100% { opacity: 0; transform: translateX(16px) rotate(0deg); }
        }
        @keyframes slide-out {
          0% { opacity: 1; transform: translateX(0) rotate(0deg); }
          19.5% { opacity: 1; transform: translateX(0) rotate(0deg); }
          19.6% { opacity: 0; transform: translateX(-12px) rotate(0deg); }
          100% { opacity: 0; transform: translateX(-16px) rotate(0deg); }
        }
        @keyframes belt-left { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        @keyframes ticker-up { from { transform: translateY(0); } to { transform: translateY(-83.3333%); } }
        @keyframes beam-flow { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
        @keyframes arrow-pulse {
          0% { box-shadow: 0 0 0 0 var(--pulse, rgba(168,85,247,0.35)); }
          70% { box-shadow: 0 0 0 16px rgba(0,0,0,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
        }
        @keyframes proof-scan {
          0% { transform: translate3d(-130%,0,0); opacity: 0; }
          18% { opacity: 1; }
          72% { opacity: 1; }
          100% { transform: translate3d(130%,0,0); opacity: 0; }
        }
        @keyframes rail-drift {
          from { background-position: 0 0; }
          to { background-position: 64px 64px; }
        }
        @keyframes wall-rise {
          from { opacity: 0; transform: translateY(16px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .cycle-hidden { opacity: 0; }
        .proof-grid { animation: rail-drift 18s linear infinite; }
        .wall-tile { animation: wall-rise 520ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .cycle-hidden, .belt-track, .ticker-track, .beam-track, .pulse-ring, .proof-grid, .wall-tile, .scan-line { animation: none !important; }
          .cycle-first .cycle-hidden, .cycle-first.cycle-hidden { opacity: 1 !important; }
        }
      `}</style>

      <main className="relative z-10">
        {/* ------------------------------------------------------------- */}
        {/* Intro                                                          */}
        {/* ------------------------------------------------------------- */}
        <section className="border-b border-white/[0.06] px-6 py-6 md:py-7">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/70">
                <span className="h-2 w-2 bg-lime-300" />
                Internal preview
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-white md:text-3xl">
                Current screenshot section iteration
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                A compact review page for the before/after stage and gallery wall.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold md:justify-end">
              <a href="#current-iteration" className="border border-lime-300/[0.35] bg-lime-300/10 px-3 py-1 text-lime-200 transition-colors hover:bg-lime-300/[0.18]">Current iteration</a>
              <a href="#variant-1" className="rounded-full border border-purple-400/25 bg-purple-500/10 px-3 py-1 text-purple-300 transition-colors hover:bg-purple-500/20">1 · Kinetic Split Studio</a>
              <a href="#variant-2" className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-300 transition-colors hover:bg-cyan-500/20">2 · Spotlight Carousel</a>
              <a href="#variant-3" className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-amber-300 transition-colors hover:bg-amber-500/20">3 · Timeline Conveyor</a>
              <a href="#variant-4" className="rounded-full border border-stone-400/25 bg-stone-500/10 px-3 py-1 text-stone-300 transition-colors hover:bg-stone-500/20">4 · Editorial Installation</a>
            </div>
          </div>
        </section>

        <CurrentLandingIteration />
        <KineticSplitStudio />
        <SpotlightCarousel />
        <TimelineConveyor />
        <EditorialInstallation />

        {/* ------------------------------------------------------------- */}
        {/* Footer note                                                    */}
        {/* ------------------------------------------------------------- */}
        <section className="border-t border-white/[0.05] bg-black px-6 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[14px] leading-relaxed text-neutral-500">
              My recommendation: use the <span className="font-semibold text-lime-200">current iteration</span> at
              the top as the homepage candidate. It keeps the clear before/after arrow idea,
              makes the section feel more premium, and lets the gallery wall carry the proof at scale.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Current landing-page iteration
// A refined candidate for the actual homepage: one clear before -> after stage
// that cycles real app examples, followed by a larger gallery wall of outputs.
// ---------------------------------------------------------------------------

const LAUNCH_DUR = 20

function CurrentLandingIteration() {
  const seg = LAUNCH_DUR / launchCycle.length
  return (
    <section id="current-iteration" className="scroll-mt-8 border-t border-white/[0.06] bg-[#080807] px-6 pb-24 pt-16 md:pb-32 md:pt-24">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[0.76fr_1.24fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 border border-lime-200/25 bg-lime-200/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-lime-100/80">
              Recommended current iteration
            </div>
            <h2 className="max-w-xl text-4xl font-bold leading-[0.98] tracking-tight text-[#f7f2df] md:text-6xl">
              From everyday capture to store-ready screenshot.
            </h2>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[#f7f2df]/[0.62]">
              Start with the screen you already have. App Listing Agent turns it
              into polished store screenshots, then keeps the whole portfolio in one place.
            </p>

            <div className="mt-9 grid max-w-xl grid-cols-3 border-y border-[#f7f2df]/10 py-5 text-left">
              {[
                ['01', 'Real screen in'],
                ['02', 'Polished screenshot out'],
                ['03', '18 app examples'],
              ].map(([n, label], i) => (
                <div key={n} className={i > 0 ? 'border-l border-[#f7f2df]/10 pl-4 sm:pl-6' : 'pr-4 sm:pr-6'}>
                  <div className="font-mono text-[11px] text-lime-200/70">{n}</div>
                  <div className="mt-1 text-[13px] font-semibold leading-snug text-[#f7f2df]/[0.78]">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute inset-[-12%] bg-[radial-gradient(55%_60%_at_55%_46%,rgba(217,255,94,0.11),transparent_72%)]" />
            <div className="relative px-0 py-3 sm:px-3 md:px-6 md:py-6">
              <div className="proof-grid pointer-events-none absolute inset-[-20px] opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgba(247,242,223,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(247,242,223,0.16) 1px, transparent 1px)', backgroundSize: '64px 64px' }} />

              <CycleStack items={launchCycle} render={(p, i) => (
                <div
                  className="cycle-hidden relative"
                  style={{ animation: `cycle-fade ${LAUNCH_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
                >
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <AppChip app={p.app} className="rounded-none" />
                      <span className="text-[13px] font-semibold text-[#f7f2df]/[0.72]">{p.title}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(0,0.82fr)_44px_minmax(0,1.12fr)] items-center gap-2 sm:grid-cols-[minmax(0,0.86fr)_64px_minmax(0,1.16fr)] sm:gap-4">
                    <div>
                      <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[#f7f2df]/[0.38] sm:text-[10px]">
                        Before
                      </div>
                      <div className="relative mx-auto max-w-[220px] -rotate-2 overflow-hidden rounded-[20px] border border-[#f7f2df]/[0.12] bg-black shadow-[0_24px_70px_rgba(0,0,0,0.55)]">
                        <div className="absolute inset-0 z-10 bg-[#080807]/10" />
                        <div className="relative aspect-[9/19]">
                          <Image
                            src={p.raw}
                            alt={`${p.app} raw app screen before screenshot generation`}
                            fill
                            sizes="220px"
                            className="object-cover opacity-[0.78] grayscale-[0.42] saturate-[0.7]"
                            unoptimized
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <div
                        className="pulse-ring relative flex h-11 w-11 items-center justify-center rounded-full border border-lime-200/[0.45] bg-lime-200 text-[#11110d] shadow-[0_0_40px_rgba(217,255,94,0.28)] sm:h-[52px] sm:w-[52px]"
                        style={{ animation: 'arrow-pulse 2.4s ease-out infinite', '--pulse': 'rgba(217,255,94,0.38)' } as CSSProperties}
                      >
                        <span className="scan-line absolute left-[-76px] right-[-76px] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-lime-200/70 to-transparent" style={{ animation: 'proof-scan 2.9s ease-in-out infinite' }} />
                        <ArrowRight className="relative z-10 h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-right font-mono text-[9px] uppercase tracking-[0.2em] text-lime-100/[0.68] sm:text-[10px]">
                        After
                      </div>
                      <div className="relative mx-auto max-w-[330px] overflow-hidden rounded-[24px] border border-lime-200/30 bg-black shadow-[0_0_70px_rgba(217,255,94,0.18),0_34px_90px_rgba(0,0,0,0.58)]">
                        <div className="relative aspect-[9/19]">
                          <Image
                            src={p.out}
                            alt={`${p.app} finished App Store screenshot after`}
                            fill
                            sizes="330px"
                            className="object-cover object-top"
                            priority={i === 0}
                            unoptimized
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )} />

              <div className="mt-7 flex justify-center gap-2">
                {launchCycle.map((p, i) => (
                  <span key={p.out} className={`relative h-1.5 w-9 overflow-hidden bg-[#f7f2df]/[0.12] ${i === 0 ? 'cycle-first' : ''}`}>
                    <span
                      className="cycle-hidden absolute inset-0 bg-lime-200"
                      style={{ animation: `cycle-cut ${LAUNCH_DUR}s linear infinite`, animationDelay: cycleDelay(i, seg) }}
                    />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-20 md:mt-28">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.26em] text-lime-200/[0.58]">
                Gallery wall
              </div>
              <h3 className="max-w-2xl text-3xl font-bold tracking-tight text-[#f7f2df] md:text-5xl">
                Pulled from the screenshot library already inside App Listing Agent.
              </h3>
            </div>
            <p className="max-w-sm text-[14px] leading-relaxed text-[#f7f2df]/[0.52]">
              Health Wrapped, Mendora, NoEnemies, PepMod, PrayLock, ThreadCam, SleepLog,
              and the wider app portfolio.
            </p>
          </div>

          <div className="relative">
            <div className="columns-2 gap-3 sm:columns-3 md:gap-4 lg:columns-5">
              {galleryWall.map((p, i) => (
                <div key={p.out} className="wall-tile group mb-3 break-inside-avoid md:mb-4" style={{ animationDelay: `${i * 55}ms` }}>
                  <div className={`relative ${galleryAspects[i % galleryAspects.length]} overflow-hidden border border-[#f7f2df]/[0.12] bg-black shadow-[0_22px_55px_rgba(0,0,0,0.45)] transition duration-300 group-hover:-translate-y-1 group-hover:border-lime-200/[0.35]`}>
                    <Image
                      src={p.out}
                      alt={`${p.app} finished store screenshot in the gallery wall`}
                      fill
                      sizes="(min-width: 1024px) 220px, (min-width: 640px) 31vw, 46vw"
                      className="object-cover object-top"
                      unoptimized
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/[0.76] via-black/[0.18] to-transparent opacity-85 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2">
                      <AppChip app={p.app} className="rounded-none shadow-[0_8px_18px_rgba(0,0,0,0.3)]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Variant 1 - Kinetic Split Studio
// A theatrical stage: raw capture stage-left, finished screenshot stage-right,
// a pulsing arrow between them, five real pairs taking turns. The section then
// resolves into a masonry wall of finished screenshots.
// ---------------------------------------------------------------------------

const studioCycle: Pair[] = [
  pairs.gymstreakAi,
  pairs.snoozyPredict,
  pairs.gymlevelsXp,
  pairs.gymlevelsMuscle,
  pairs.gymstreakProgress,
]
const STUDIO_DUR = 20 // seconds for the full 5-pair loop

const wallAspects = ['aspect-[9/19]', 'aspect-[9/16]', 'aspect-[3/4]', 'aspect-[9/17]']

function KineticSplitStudio() {
  const seg = STUDIO_DUR / studioCycle.length
  return (
    <section id="variant-1" className="scroll-mt-8 border-t border-white/[0.05] bg-[#0a0714] px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <VariantHeader
          n={1}
          accent="border-purple-500/25 bg-purple-500/10 text-purple-400"
          kicker="Kinetic Split Studio"
          title="Watch a capture become a storefront."
          subtitle="One stage, two sides. The raw capture enters on the left, the finished store screenshot lands on the right, and real apps take turns making the jump - then the whole body of work hangs on the wall below."
        />

        {/* The stage */}
        <div className="relative mt-16 md:mt-20">
          <div className="pointer-events-none absolute inset-x-8 -top-10 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(168,85,247,0.14),transparent_75%)]" />
          <div className="relative overflow-hidden rounded-[28px] border border-purple-400/15 bg-[linear-gradient(165deg,rgba(139,92,246,0.08),rgba(10,7,20,0.4)_45%,rgba(59,130,246,0.06))] px-4 pb-10 pt-8 shadow-[0_50px_120px_rgba(0,0,0,0.6)] sm:px-8 md:px-14 md:pb-12 md:pt-10">
            {/* Cycling marquee label */}
            <CycleStack items={studioCycle} className="mb-8" render={(p, i) => (
              <div
                className="cycle-hidden flex flex-wrap items-center justify-center gap-2.5"
                style={{ animation: `cycle-fade ${STUDIO_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
              >
                <AppChip app={p.app} />
                <span className="text-[14px] font-semibold text-white/80">{p.title}</span>
              </div>
            )} />

            {/* Cycling pair */}
            <div className="relative">
              <CycleStack items={studioCycle} render={(p, i) => (
                <div
                  className="cycle-hidden flex items-center justify-between"
                  style={{ animation: `cycle-fade ${STUDIO_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
                >
                  {/* Before */}
                  <div className="w-[36%] max-w-[210px]">
                    <div className="mb-2.5 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-white/40 sm:text-[10px]">
                      Before · raw capture
                    </div>
                    <div className="relative -rotate-2 overflow-hidden rounded-2xl border border-white/[0.12] bg-neutral-950 shadow-[0_25px_60px_rgba(0,0,0,0.55)]">
                      <div className="relative aspect-[9/19]">
                        <Image
                          src={p.raw}
                          alt={`${p.app} raw capture, before`}
                          fill
                          sizes="210px"
                          className="object-cover opacity-80 grayscale-[0.45]"
                          unoptimized
                        />
                      </div>
                    </div>
                  </div>

                  {/* Spacer where the fixed arrow sits */}
                  <div className="w-10 shrink-0 sm:w-16" />

                  {/* After */}
                  <div className="w-[52%] max-w-[300px]">
                    <div className="mb-2.5 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-purple-300/80 sm:text-[10px]">
                      After · store screenshot
                    </div>
                    <div className="relative overflow-hidden rounded-2xl border border-purple-300/30 bg-neutral-950 shadow-[0_0_60px_rgba(139,92,246,0.28),0_35px_80px_rgba(0,0,0,0.55)]">
                      <div className="relative aspect-[9/19]">
                        <Image
                          src={p.out}
                          alt={`${p.app} - ${p.title}, finished store screenshot, after`}
                          fill
                          sizes="300px"
                          className="object-cover"
                          priority={i === 0}
                          unoptimized
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )} />

              {/* Fixed arrow between the two sides (sits over the spacer at ~41%) */}
              <div className="pointer-events-none absolute left-[41%] top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div
                  className="pulse-ring flex h-10 w-10 items-center justify-center rounded-full border border-purple-300/40 bg-purple-500/20 text-purple-200 backdrop-blur-sm sm:h-12 sm:w-12"
                  style={{ animation: 'arrow-pulse 2.4s ease-out infinite', '--pulse': 'rgba(168,85,247,0.4)' } as CSSProperties}
                >
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
              </div>
            </div>

            {/* Cycle progress dots */}
            <div className="mt-9 flex justify-center gap-2.5">
              {studioCycle.map((p, i) => (
                <span key={p.out} className={`relative h-1.5 w-7 overflow-hidden rounded-full bg-white/10 ${i === 0 ? 'cycle-first' : ''}`}>
                  <span
                    className="cycle-hidden absolute inset-0 rounded-full bg-purple-400"
                    style={{ animation: `cycle-cut ${STUDIO_DUR}s linear infinite`, animationDelay: cycleDelay(i, seg) }}
                  />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* The wall */}
        <div className="mt-20 md:mt-24">
          <div className="mx-auto mb-10 max-w-xl text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-purple-300/70">
              The finish wall
            </div>
            <h3 className="text-2xl font-bold tracking-tight md:text-3xl">
              Everyday captures, turned into launch-ready store visuals.
            </h3>
          </div>
          <div className="columns-2 gap-4 sm:columns-3 lg:columns-4 [column-fill:balance]">
            {allPairs.map((p, i) => (
              <div key={p.out} className="group mb-4 break-inside-avoid">
                <div className={`relative ${wallAspects[i % wallAspects.length]} overflow-hidden rounded-2xl border border-white/[0.09] bg-neutral-950 shadow-[0_20px_50px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:-translate-y-1.5`}>
                  <Image
                    src={p.out}
                    alt={`${p.app} - ${p.title}, finished store screenshot`}
                    fill
                    sizes="(min-width: 1024px) 270px, (min-width: 640px) 32vw, 46vw"
                    className="object-cover object-top"
                    unoptimized
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="absolute bottom-2.5 left-2.5 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <AppChip app={p.app} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Verdict
          accent="text-purple-400"
          text="The most theatrical of the four - the stage gives the transformation real presence, the dots make the cycle legible, and the masonry wall lands the volume argument. Tradeoff: it wants vertical space; this is a centerpiece section, not a filler."
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Variant 2 - Spotlight Carousel
// A light-bridge composition: raw and finished slide in from opposite wings
// and meet at an energized arrow bridge, while a split-flap ticker rotates the
// app names above. Behind it, a spotlit wall of finished screenshots.
// ---------------------------------------------------------------------------

const carouselCycle: Pair[] = [
  pairs.gymstreakProgress,
  pairs.snoozySounds,
  pairs.gymlevelsXp,
  pairs.snoozyWeekly,
  pairs.snoozyPredict,
]
const CAROUSEL_DUR = 20

function SpotlightCarousel() {
  const seg = CAROUSEL_DUR / carouselCycle.length
  const tickerRows = [...carouselCycle.map((p) => p.app), carouselCycle[0].app]
  const wall = [
    pairs.gymlevelsXp, pairs.snoozyPredict, pairs.gymstreakAi, pairs.gymlevelsMuscle,
    pairs.snoozyWeekly, pairs.gymstreakProgress, pairs.snoozySounds,
  ]
  const tilts = ['rotate-1', '-rotate-2', 'rotate-2', '-rotate-1', 'rotate-1', '-rotate-1', 'rotate-2', '-rotate-2', 'rotate-1', '-rotate-1']
  return (
    <section id="variant-2" className="scroll-mt-8 border-t border-white/[0.05] bg-[#020b10] px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <VariantHeader
          n={2}
          accent="border-cyan-500/25 bg-cyan-500/10 text-cyan-400"
          kicker="Spotlight Carousel"
          title="Every app crosses the same bridge."
          subtitle="Raw captures slide in from the left wing, finished store screenshots from the right, and they meet over a live arrow bridge while the marquee rotates through the lineup. The wall behind holds the finished work."
        />

        <div className="mt-16 md:mt-20">
          {/* Split-flap app ticker */}
          <div className="mb-10 flex flex-wrap items-center justify-center gap-3">
            <span className="text-[13px] font-semibold text-white/40">Now on the bridge</span>
            <div className="h-9 overflow-hidden rounded-lg border border-cyan-400/20 bg-cyan-500/[0.07] px-4">
              <div className="ticker-track flex flex-col" style={{ animation: `ticker-up ${CAROUSEL_DUR}s steps(5, end) infinite` }}>
                {tickerRows.map((app, i) => (
                  <span key={`${app}-${i}`} className="flex h-9 items-center justify-center font-mono text-[12px] font-bold uppercase tracking-[0.22em] text-cyan-300">
                    {app}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* The bridge */}
          <div className="relative mx-auto max-w-4xl">
            {/* Spotlight cones */}
            <div className="pointer-events-none absolute -inset-x-6 -top-16 bottom-0 bg-[radial-gradient(38%_60%_at_18%_0%,rgba(34,211,238,0.09),transparent_70%),radial-gradient(38%_60%_at_82%_0%,rgba(34,211,238,0.11),transparent_70%)]" />

            <div className="relative">
              <CycleStack items={carouselCycle} render={(p, i) => (
                <div className="flex items-center justify-between">
                  {/* Before - slides in from the left */}
                  <div
                    className="cycle-hidden w-[38%] max-w-[230px]"
                    style={{ animation: `slide-raw ${CAROUSEL_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
                  >
                    <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-neutral-950 shadow-[0_25px_60px_rgba(0,0,0,0.55)]">
                      <div className="relative aspect-[9/19]">
                        <Image
                          src={p.raw}
                          alt={`${p.app} raw capture entering from the left`}
                          fill
                          sizes="230px"
                          className="object-cover opacity-80 grayscale-[0.4]"
                          unoptimized
                        />
                      </div>
                      <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white/60 backdrop-blur-sm">
                        Before
                      </div>
                    </div>
                  </div>

                  {/* After - slides in from the right */}
                  <div
                    className="cycle-hidden w-[44%] max-w-[265px]"
                    style={{ animation: `slide-out ${CAROUSEL_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
                  >
                    <div className="relative overflow-hidden rounded-2xl border border-cyan-300/30 bg-neutral-950 shadow-[0_0_55px_rgba(34,211,238,0.22),0_30px_70px_rgba(0,0,0,0.55)]">
                      <div className="relative aspect-[9/19]">
                        <Image
                          src={p.out}
                          alt={`${p.app} - ${p.title}, finished store screenshot arriving from the right`}
                          fill
                          sizes="265px"
                          className="object-cover"
                          priority={i === 0}
                          unoptimized
                        />
                      </div>
                      <div className="absolute left-2 top-2 rounded-md bg-cyan-500/25 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-100 backdrop-blur-sm">
                        After
                      </div>
                    </div>
                  </div>
                </div>
              )} />

              {/* Energized beam between the wings */}
              <div
                className="beam-track pointer-events-none absolute left-[39%] right-[45%] top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, rgba(34,211,238,0), rgba(34,211,238,0.9), rgba(34,211,238,0))',
                  backgroundSize: '200% 100%',
                  animation: 'beam-flow 2.6s linear infinite',
                }}
              />
              {/* Arrow keystone */}
              <div className="pointer-events-none absolute left-[47%] top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div
                  className="pulse-ring flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/40 bg-[#031318] text-cyan-200 shadow-[0_0_35px_rgba(34,211,238,0.35)]"
                  style={{ animation: 'arrow-pulse 2.6s ease-out infinite', '--pulse': 'rgba(34,211,238,0.35)' } as CSSProperties}
                >
                  <ArrowRight className="h-[18px] w-[18px]" />
                </div>
              </div>
            </div>

            <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-300/60">
              One pass · headline set · device framed · every locale
            </p>
          </div>
        </div>

        {/* Spotlit wall */}
        <div className="relative mt-20 md:mt-24">
          <div className="pointer-events-none absolute -inset-x-6 -top-8 bottom-0 bg-[radial-gradient(45%_55%_at_30%_0%,rgba(34,211,238,0.07),transparent_70%),radial-gradient(45%_55%_at_75%_10%,rgba(59,130,246,0.06),transparent_70%)]" />
          <div className="relative">
            <div className="mx-auto mb-10 max-w-xl text-center">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300/70">
                Off the bridge, onto the wall
              </div>
              <h3 className="text-2xl font-bold tracking-tight md:text-3xl">
                Finished screenshots, ready for the store page.
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {wall.map((p, i) => (
                <div key={`${p.out}-${i}`} className="group">
                  <div className={`relative aspect-[9/19] overflow-hidden rounded-xl border border-white/[0.1] bg-neutral-950 shadow-[0_18px_45px_rgba(0,0,0,0.5)] transition-transform duration-300 ${tilts[i % tilts.length]} group-hover:rotate-0 group-hover:scale-[1.03]`}>
                    <Image
                      src={p.out}
                      alt={`${p.app} - ${p.title}, finished store screenshot`}
                      fill
                      sizes="(min-width: 1024px) 210px, (min-width: 640px) 32vw, 46vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="mt-2.5 flex justify-center">
                    <AppChip app={p.app} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Verdict
          accent="text-cyan-400"
          text="The most kinetic pairing of motion and meaning - opposite-wing slides literally act out before-meets-after, and the split-flap ticker names each app as it crosses. Tradeoff: the busiest variant; it needs breathing room above and below on the page."
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Variant 3 - Timeline Conveyor
// A production line: an assembly stage up top cuts hard between pairs like a
// stamping press, a conveyor belt of before -> after units runs underneath,
// and the line empties onto a shelved wall of finished screenshots.
// ---------------------------------------------------------------------------

const conveyorCycle: Pair[] = [
  pairs.gymlevelsMuscle,
  pairs.snoozyWeekly,
  pairs.gymstreakAi,
  pairs.gymlevelsXp,
  pairs.snoozySounds,
]
const CONVEYOR_DUR = 15 // hard cuts, 3s per pair

function TimelineConveyor() {
  const seg = CONVEYOR_DUR / conveyorCycle.length
  const beltUnits = [...allPairs, ...allPairs]
  const shelves: Pair[][] = [
    [pairs.gymstreakProgress, pairs.snoozyPredict, pairs.gymlevelsXp, pairs.snoozySounds, pairs.gymlevelsMuscle],
    [pairs.gymstreakAi, pairs.snoozyWeekly],
  ]
  return (
    <section id="variant-3" className="scroll-mt-8 overflow-hidden border-t border-white/[0.05] bg-[#0d0903] px-0 py-24 md:py-32">
      <div className="px-6">
        <VariantHeader
          n={3}
          accent="border-amber-500/25 bg-amber-500/10 text-amber-400"
          kicker="Timeline Conveyor"
          title="A production line for your store page."
          subtitle="The press up top stamps each raw capture into its finished store screenshot with a hard cut, the belt below keeps the whole lineup moving, and everything rolls off the line onto the shelf wall."
        />
      </div>

      {/* Assembly stage - hard-cut cycling pair */}
      <div className="mx-auto mt-16 max-w-4xl px-6 md:mt-20">
        <div className="relative rounded-2xl border border-amber-400/15 bg-[#120c04] p-4 shadow-[0_40px_90px_rgba(0,0,0,0.6)] sm:p-8">
          {/* Hazard strip */}
          <div className="absolute inset-x-0 top-0 h-1.5 rounded-t-2xl bg-[repeating-linear-gradient(45deg,rgba(251,191,36,0.55)_0px,rgba(251,191,36,0.55)_10px,rgba(0,0,0,0.6)_10px,rgba(0,0,0,0.6)_20px)]" />

          <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300/70">
            <span className="inline-flex items-center gap-2">
              <Camera className="h-3.5 w-3.5" />
              Station 01 · the press
            </span>
            <span className="text-white/30">3 seconds per unit</span>
          </div>

          <div className="relative">
            <CycleStack items={conveyorCycle} render={(p, i) => (
              <div
                className="cycle-hidden"
                style={{ animation: `cycle-cut ${CONVEYOR_DUR}s linear infinite`, animationDelay: cycleDelay(i, seg) }}
              >
                <div className="mb-4 flex justify-center">
                  <AppChip app={p.app} />
                </div>
                <div className="flex items-center justify-between">
                  {/* Before */}
                  <div className="w-[34%] max-w-[190px]">
                    <div className="relative overflow-hidden rounded-lg border border-white/[0.12] bg-neutral-950">
                      <div className="relative aspect-[9/19]">
                        <Image
                          src={p.raw}
                          alt={`${p.app} raw capture entering the press`}
                          fill
                          sizes="190px"
                          className="object-cover opacity-75 grayscale-[0.5]"
                          unoptimized
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">
                      In · raw
                    </div>
                  </div>

                  <div className="w-10 shrink-0 sm:w-16" />

                  {/* After */}
                  <div className="w-[50%] max-w-[270px]">
                    <div className="relative overflow-hidden rounded-lg border border-amber-300/30 bg-neutral-950 shadow-[0_0_45px_rgba(251,191,36,0.18)]">
                      <div className="relative aspect-[9/19]">
                        <Image
                          src={p.out}
                          alt={`${p.app} - ${p.title}, finished store screenshot leaving the press`}
                          fill
                          sizes="270px"
                          className="object-cover"
                          priority={i === 0}
                          unoptimized
                        />
                      </div>
                      <div className="absolute right-2 top-2 -rotate-6 rounded border border-amber-300/60 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-amber-300">
                        Store-ready
                      </div>
                    </div>
                    <div className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-amber-300/70">
                      Out · finished
                    </div>
                  </div>
                </div>
              </div>
            )} />

            {/* Fixed press arrow */}
            <div className="pointer-events-none absolute left-[40%] top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div
                className="pulse-ring flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300/40 bg-amber-500/15 text-amber-300"
                style={{ animation: 'arrow-pulse 3s ease-out infinite', '--pulse': 'rgba(251,191,36,0.3)' } as CSSProperties}
              >
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The belt - before -> after units in motion */}
      <div className="mt-14 md:mt-16">
        <div className="mb-4 flex items-center justify-center gap-2 px-6 font-mono text-[10px] uppercase tracking-[0.24em] text-amber-300/60">
          <Wand2 className="h-3.5 w-3.5" />
          Station 02 · the line, always running
        </div>
        <div className="relative overflow-hidden border-y border-amber-400/15 bg-[#0a0602] py-5">
          <div className="belt-track flex w-max items-center gap-10" style={{ animation: 'belt-left 70s linear infinite' }}>
            {beltUnits.map((p, i) => (
              <div key={`unit-${i}`} className="flex shrink-0 items-center gap-2.5">
                <div className="w-[62px]">
                  <div className="relative aspect-[9/19] overflow-hidden rounded-md border border-white/[0.1] bg-neutral-950">
                    <Image
                      src={p.raw}
                      alt={`${p.app} raw capture on the line`}
                      fill
                      sizes="62px"
                      className="object-cover opacity-65 grayscale-[0.6]"
                      unoptimized
                    />
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
                <div className="w-[78px]">
                  <div className="relative aspect-[9/19] overflow-hidden rounded-md border border-amber-300/25 bg-neutral-950 shadow-[0_0_20px_rgba(251,191,36,0.12)]">
                    <Image
                      src={p.out}
                      alt={`${p.app} finished store screenshot on the line`}
                      fill
                      sizes="78px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#0d0903] to-transparent md:w-28" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#0d0903] to-transparent md:w-28" />
        </div>
        {/* Rollers */}
        <div className="mx-auto mt-2 flex max-w-4xl justify-between px-10">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="h-2 w-2 rounded-full border border-amber-400/25 bg-[#1a1206]" />
          ))}
        </div>
      </div>

      {/* Shelf wall */}
      <div className="mx-auto mt-16 max-w-5xl px-6 md:mt-20">
        <div className="mb-10 flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-amber-300/60">
          <Store className="h-3.5 w-3.5" />
          Station 03 · off the line, onto the shelves
        </div>
        {shelves.map((row, r) => (
          <div key={r} className={r > 0 ? 'mt-10' : ''}>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 sm:gap-5">
              {row.map((p, i) => (
                <div key={p.out} className={`group ${i > 2 ? 'hidden sm:block' : ''}`}>
                  <div className="relative aspect-[9/19] overflow-hidden rounded-lg border border-white/[0.1] bg-neutral-950 shadow-[0_16px_40px_rgba(0,0,0,0.5)] transition-transform duration-300 group-hover:-translate-y-1.5">
                    <Image
                      src={p.out}
                      alt={`${p.app} - ${p.title}, finished store screenshot on the shelf`}
                      fill
                      sizes="(min-width: 640px) 190px, 30vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="mt-2 flex justify-center">
                    <AppChip app={p.app} />
                  </div>
                </div>
              ))}
            </div>
            {/* Shelf plank */}
            <div className="mt-3 h-1.5 rounded-full bg-gradient-to-r from-transparent via-[#3a2c14] to-transparent" />
            <div className="h-6 bg-gradient-to-b from-[#160f05]/70 to-transparent" />
          </div>
        ))}
      </div>

      <div className="px-6">
        <Verdict
          accent="text-amber-400"
          text="The hard-cut press plus the always-moving belt makes throughput the story - lots of apps, no waiting. Tradeoff: the most mechanical personality of the four; it sells speed more than craft."
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Variant 4 - Editorial Gallery Installation
// A light-mode museum wing: an oversized framed comparison rotates slowly on
// the feature wall with figure captions, then the corridor opens into a dense
// salon-hung wall of finished pieces.
// ---------------------------------------------------------------------------

const editorialCycle: Pair[] = [
  pairs.snoozyPredict,
  pairs.gymlevelsXp,
  pairs.gymstreakProgress,
  pairs.gymlevelsMuscle,
  pairs.snoozyWeekly,
]
const EDITORIAL_DUR = 30 // slow, gallery-paced

function EditorialInstallation() {
  const seg = EDITORIAL_DUR / editorialCycle.length
  return (
    <section id="variant-4" className="scroll-mt-8 border-t border-white/[0.05] bg-[#f4f1e9] px-6 py-24 text-[#17140f] md:py-32">
      <div className="mx-auto max-w-6xl">
        <VariantHeader
          n={4}
          accent="border-[#17140f]/20 bg-[#17140f]/[0.06] text-[#17140f]/70"
          kicker="Editorial Gallery Installation"
          title="Hung, framed, and captioned."
          subtitle="A full light-mode break. The feature wall rotates slowly through oversized comparisons - the raw capture pinned as the study, the finished store screenshot in the frame - before the wing opens into the permanent collection."
          dark={false}
        />

        {/* Feature wall */}
        <div className="mt-16 md:mt-20">
          <div className="mb-8 flex items-center justify-center gap-3 text-[11px] font-bold uppercase tracking-[0.28em] text-[#17140f]/50">
            <Landmark className="h-4 w-4" />
            Wing I · The comparison wall
          </div>

          <div className="relative mx-auto max-w-4xl border border-[#17140f]/15 bg-[#faf8f1] px-4 pb-10 pt-10 shadow-[0_40px_90px_rgba(23,20,15,0.14)] sm:px-10">
            <div className="relative">
              <CycleStack items={editorialCycle} render={(p, i) => (
                <div
                  className="cycle-hidden flex items-center justify-between"
                  style={{ animation: `cycle-fade ${EDITORIAL_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
                >
                  {/* The study - raw capture, taped up */}
                  <div className="w-[32%] max-w-[190px]">
                    <div className="relative -rotate-2 bg-white p-1.5 pb-6 shadow-[0_18px_40px_rgba(23,20,15,0.25)] sm:p-2 sm:pb-8">
                      <div className="absolute -top-2.5 left-1/2 h-5 w-16 -translate-x-1/2 rotate-2 bg-[#d9d2bd]/90 shadow-sm" />
                      <div className="relative aspect-[9/19] overflow-hidden bg-neutral-900">
                        <Image
                          src={p.raw}
                          alt={`${p.app} raw capture, exhibited as the study`}
                          fill
                          sizes="190px"
                          className="object-cover grayscale-[0.35]"
                          unoptimized
                        />
                      </div>
                      <div className="absolute bottom-1.5 left-0 right-0 text-center font-serif text-[10px] italic text-[#17140f]/60 sm:text-[11px]">
                        fig. 1 - the capture
                      </div>
                    </div>
                  </div>

                  <div className="w-10 shrink-0 sm:w-16" />

                  {/* The piece - finished screenshot, framed */}
                  <div className="w-[54%] max-w-[300px]">
                    <div className="border-[6px] border-[#17140f] bg-[#efe9da] p-2 shadow-[0_35px_70px_rgba(23,20,15,0.3)] sm:border-8 sm:p-3">
                      <div className="relative aspect-[9/19] overflow-hidden bg-neutral-900">
                        <Image
                          src={p.out}
                          alt={`${p.app} - ${p.title}, finished store screenshot, framed`}
                          fill
                          sizes="300px"
                          className="object-cover"
                          priority={i === 0}
                          unoptimized
                        />
                      </div>
                    </div>
                    <div className="mt-2.5 text-center font-serif text-[11px] italic text-[#17140f]/60 sm:text-[12px]">
                      fig. 2 - the finished store screenshot
                    </div>
                  </div>
                </div>
              )} />

              {/* Inked arrow marker between study and piece */}
              <div className="pointer-events-none absolute left-[38%] top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#17140f] bg-[#faf8f1] text-[#17140f] shadow-[0_8px_20px_rgba(23,20,15,0.2)] sm:h-11 sm:w-11">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* Rotating placard */}
            <div className="relative mt-9 h-16 sm:h-14">
              <CycleStack items={editorialCycle} className="h-full" render={(p, i) => (
                <div
                  className="cycle-hidden text-center"
                  style={{ animation: `cycle-fade ${EDITORIAL_DUR}s ease-in-out infinite`, animationDelay: cycleDelay(i, seg) }}
                >
                  <p className="font-serif text-[17px] italic leading-snug sm:text-[19px]">
                    &ldquo;{p.title}&rdquo; <span className="not-italic text-[#17140f]/50">— {p.app}</span>
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#17140f]/45">
                    Medium: one everyday capture, restyled for the storefront
                  </p>
                </div>
              )} />
            </div>
          </div>
        </div>

        {/* The permanent collection - salon wall */}
        <div className="mt-20 md:mt-24">
          <div className="mb-4 flex items-center justify-center gap-3 text-[11px] font-bold uppercase tracking-[0.28em] text-[#17140f]/50">
            <Languages className="h-4 w-4" />
            Wing II · The permanent collection
          </div>
          <p className="mx-auto mb-10 max-w-md text-center font-serif text-[16px] italic leading-relaxed text-[#17140f]/60">
            Eleven finished pieces, each begun as an ordinary screen capture.
          </p>
          <div className="columns-2 gap-5 sm:columns-3 lg:columns-4">
            {allPairs.map((p, i) => (
              <div key={p.out} className="group mb-5 break-inside-avoid">
                <div className={`border-[5px] border-[#17140f] bg-[#efe9da] p-1.5 shadow-[0_20px_45px_rgba(23,20,15,0.18)] transition-transform duration-300 group-hover:-translate-y-1 ${i % 3 === 1 ? 'rotate-[0.6deg]' : i % 3 === 2 ? '-rotate-[0.6deg]' : ''}`}>
                  <div className={`relative ${wallAspects[(i + 1) % wallAspects.length]} overflow-hidden bg-neutral-900`}>
                    <Image
                      src={p.out}
                      alt={`${p.app} - ${p.title}, finished store screenshot in the collection`}
                      fill
                      sizes="(min-width: 1024px) 260px, (min-width: 640px) 32vw, 46vw"
                      className="object-cover object-top"
                      unoptimized
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex items-baseline justify-between px-1">
                  <span className="font-serif text-[12px] italic text-[#17140f]/70">No. {String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#17140f]/50">{p.app}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Verdict
          accent="text-[#17140f]/70"
          text="The light-mode break is the most memorable single moment across the four, and the slow rotation gives each comparison time to register. Tradeoff: the least urgent - it flatters the output beautifully but sells throughput the least."
          dark={false}
        />
      </div>
    </section>
  )
}
