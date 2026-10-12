import type { CSSProperties, ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Check, ArrowRight, Globe, Palette, FileText, Smartphone, GitCommitHorizontal, MessageSquare, ShieldCheck } from 'lucide-react'
import Starfield from '@/components/Starfield'
import PricingSection from '@/components/PricingSection'
import { BookingLink, TrackedFunnelLink } from '@/components/concierge/booking-link'
import { VslPlayer } from '@/components/landing/vsl-player'
import { serializeJsonLd } from '@/lib/seo/json-ld'
import { organizationJsonLd, softwareApplicationJsonLd, websiteJsonLd } from '@/lib/seo/site'

const HOME_TITLE = 'App Listing Agent — Run your app-store operations with AI'
const HOME_SOCIAL_DESCRIPTION = 'Connect your AI agent to App Store Connect and Google Play, then audit, localize, create, and publish with approval gates.'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'App Listing Agent',
    title: HOME_TITLE,
    description: HOME_SOCIAL_DESCRIPTION,
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'App Listing Agent — AI operations for the app stores' }],
  },
}

// Organization + WebSite (the "#website" node the use-case pages reference)
// + SoftwareApplication. Offers live on /pricing, where every price is shown.
const homeStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd()],
}

type ScreenshotPair = {
  app: string
  title: string
  raw: string
  out: string
}

const NB = '/images/landing/nano-banana'

const launchCycle: ScreenshotPair[] = [
  { app: 'GymLevels', title: 'Earn XP in your workouts', raw: `${NB}/gymlevels-xp-raw.png`, out: `${NB}/gymlevels-xp-marketing.jpg` },
  { app: 'GymStreak', title: 'Target your muscles', raw: '/images/landing/applistingagent-screenshots/gymstreak-target-muscles-raw.png', out: '/images/landing/applistingagent-screenshots/gymstreak-target-your-muscles-appstore.jpg' },
  { app: 'ThreadCam', title: 'ThreadCam App Store screenshot', raw: '/images/landing/applistingagent-screenshots/threadcam-regular-tshirt-fabric-raw.png', out: '/images/landing/applistingagent-screenshots/threadcam-app-iphone-69-80f7b1c2.jpg' },
]

const galleryWall: ScreenshotPair[] = [
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
  { app: 'FlexBod', title: 'YOUR PERSONAL STRETCH COACH', raw: '/images/landing/applistingagent-screenshots/flexbod-app-iphone-69-90b3c9c6.jpg', out: '/images/landing/applistingagent-screenshots/flexbod-app-iphone-69-90b3c9c6.jpg' },
  { app: 'BabyRelay', title: 'One shared log for every caregiver.', raw: '/images/landing/applistingagent-screenshots/babyrelay-app-iphone-69-60ee838a.jpg', out: '/images/landing/applistingagent-screenshots/babyrelay-app-iphone-69-60ee838a.jpg' },
  { app: 'OvaKind', title: 'PCOS tracking for irregular cycles', raw: '/images/landing/applistingagent-screenshots/ovakind-app-iphone-69-f119ba53.jpg', out: '/images/landing/applistingagent-screenshots/ovakind-app-iphone-69-f119ba53.jpg' },
  { app: 'PixelShift', title: 'Edit photos with words.', raw: '/images/landing/applistingagent-screenshots/pixelshift-app-iphone-69-8a014714.jpg', out: '/images/landing/applistingagent-screenshots/pixelshift-app-iphone-69-8a014714.jpg' },
]

const appIconExamples = [
  { app: 'GymStreak', src: '/images/landing/app-icons/gymstreak.jpg' },
  { app: 'PrayLock', src: '/images/landing/app-icons/praylock.jpg' },
  { app: 'ThreadCam', src: '/images/landing/app-icons/threadcam.jpg' },
  { app: 'Bare Minimum', src: '/images/landing/app-icons/bare-minimum.jpg' },
]

const appIconCarousel = [
  { app: 'Mendora', src: '/images/landing/app-icons/mendora.jpg' },
  { app: 'GymLevels', src: '/images/landing/app-icons/gymlevels.jpg' },
  { app: 'BabyRelay', src: '/images/landing/app-icons/babyrelay.jpg' },
  { app: 'Wake Saga', src: '/images/landing/app-icons/wake-saga.jpg' },
  { app: 'PepMod', src: '/images/landing/app-icons/pepmod.jpg' },
  { app: 'SleepLog', src: '/images/landing/app-icons/sleeplog.jpg' },
  { app: 'No Enemies', src: '/images/landing/app-icons/no-enemies.jpg' },
  { app: 'LoadScore', src: '/images/landing/app-icons/loadscore.jpg' },
  { app: 'Golfonaut', src: '/images/landing/app-icons/golfonaut.jpg' },
]

const customStorePageVariants = [
  {
    angle: 'T-shirt search',
    page: 'ThreadCam T-shirt Mockups',
    intent: 'A page for people searching for 3D T-shirt mockups.',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-cpp-tshirt-mockups.jpg',
  },
  {
    angle: 'Hoodie ads',
    page: 'ThreadCam Hoodie Drops',
    intent: 'A page for streetwear and launch campaign traffic.',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-cpp-hoodie-drops.jpg',
  },
  {
    angle: 'POD sellers',
    page: 'ThreadCam POD Mockups',
    intent: 'A page for sellers who need better product images fast.',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-cpp-pod-mockups.jpg',
  },
]

const localizedScreenshotExamples = [
  {
    locale: 'German',
    code: 'de-DE',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-localized-de.jpg',
  },
  {
    locale: 'Japanese',
    code: 'ja',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-localized-ja.jpg',
  },
  {
    locale: 'Spanish',
    code: 'es',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-localized-es.jpg',
  },
  {
    locale: 'French',
    code: 'fr',
    screenshot: '/images/landing/applistingagent-screenshots/threadcam-localized-fr.jpg',
  },
]

function CycleStack({
  items,
  className = '',
  render,
}: {
  items: ScreenshotPair[]
  className?: string
  render: (p: ScreenshotPair, i: number) => ReactNode
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

const LAUNCH_CYCLE_DURATION = 20
const LAUNCH_CYCLE_VISIBLE_PERCENT = (100 / launchCycle.length) - 0.5
const LAUNCH_CYCLE_HIDE_PERCENT = LAUNCH_CYCLE_VISIBLE_PERCENT + 0.1

function cycleDelay(i: number, segment: number) {
  return `${-(i * segment)}s`
}

function MarketingScreenshotsSection() {
  const segment = LAUNCH_CYCLE_DURATION / launchCycle.length

  return (
    <section id="screenshots" className="scroll-mt-24 overflow-hidden border-t border-white/[0.06] bg-[#080807] px-6 pb-24 pt-24 md:pb-32 md:pt-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[0.76fr_1.24fr] lg:items-center">
          <div>
            <h2 className="max-w-xl text-4xl font-bold leading-[0.98] tracking-tight text-[#f7f2df] md:text-6xl">
              Raw screenshot in. Store-ready screenshot out.
            </h2>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[#f7f2df]/[0.62]">
              Your AI agent hands over one plain simulator capture and gets back the finished
              App Store marketing shot — a single tool call. No templates, no mockup busywork.
            </p>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute inset-[-12%] bg-[radial-gradient(55%_60%_at_55%_46%,rgba(255,255,255,0.1),transparent_72%)]" />
            <div className="relative px-0 py-3 sm:px-3 md:px-6 md:py-6">
              <div
                className="landing-proof-grid pointer-events-none absolute inset-[-20px] opacity-[0.08]"
                style={{
                  backgroundImage: 'linear-gradient(rgba(247,242,223,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(247,242,223,0.16) 1px, transparent 1px)',
                  backgroundSize: '64px 64px',
                }}
              />

              <CycleStack items={launchCycle} render={(pair, i) => (
                <div
                  className="cycle-hidden relative"
                  style={{ animation: `landing-cycle-fade ${LAUNCH_CYCLE_DURATION}s ease-in-out infinite`, animationDelay: cycleDelay(i, segment) }}
                >
                  <div className="relative">
                    <div className="relative z-10 grid grid-cols-[minmax(0,0.82fr)_44px_minmax(0,1.12fr)] items-center gap-2 sm:grid-cols-[minmax(0,0.86fr)_64px_minmax(0,1.16fr)] sm:gap-4">
                      <div>
                        <div className="relative mx-auto max-w-[220px] -rotate-2 overflow-hidden rounded-[20px] border border-white/35 bg-black shadow-[0_0_34px_rgba(255,255,255,0.08),0_24px_70px_rgba(0,0,0,0.55)]">
                          <div className="relative aspect-[9/19]">
                            <Image
                              src={pair.raw}
                              alt={`${pair.app} raw app screen before screenshot generation`}
                              fill
                              sizes="220px"
                              className="object-cover object-top"
                              unoptimized
                            />
                          </div>
                        </div>
                      </div>

                      <div className="relative z-20 flex justify-center">
                        <div
                          className="landing-pulse-ring relative flex h-11 w-11 items-center justify-center rounded-full border border-white/55 bg-white/[0.1] text-white shadow-[0_0_42px_rgba(255,255,255,0.24)] backdrop-blur-sm sm:h-[52px] sm:w-[52px]"
                          style={{ animation: 'landing-arrow-pulse 2.4s ease-out infinite', '--pulse': 'rgba(255,255,255,0.32)' } as CSSProperties}
                        >
                          <ArrowRight className="relative z-10 h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                      </div>

                      <div>
                        <div className="relative mx-auto max-w-[330px] overflow-hidden rounded-[24px] border border-white/35 bg-black shadow-[0_0_72px_rgba(255,255,255,0.14),0_34px_90px_rgba(0,0,0,0.58)]">
                          <div className="relative aspect-[9/19]">
                            <Image
                              src={pair.out}
                              alt={`${pair.app} finished App Store screenshot after`}
                              fill
                              sizes="330px"
                              className="object-cover object-top"
                              unoptimized
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )} />

              <div className="mt-7 flex justify-center gap-2">
                {launchCycle.map((pair, i) => (
                  <span key={pair.out} className={`relative h-1.5 w-9 overflow-hidden bg-[#f7f2df]/[0.12] ${i === 0 ? 'cycle-first' : ''}`}>
                    <span
                      className="cycle-hidden absolute inset-0 bg-white"
                      style={{ animation: `landing-cycle-cut ${LAUNCH_CYCLE_DURATION}s linear infinite`, animationDelay: cycleDelay(i, segment) }}
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
              <h3 className="max-w-2xl text-3xl font-bold tracking-tight text-[#f7f2df] md:text-5xl">
                Real screenshots, shipped through App Listing Agent.
              </h3>
            </div>
          </div>

          <div className="relative">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-5">
              {galleryWall.map((pair, i) => (
                <div key={pair.out} className="landing-wall-tile group" style={{ animationDelay: `${i * 45}ms` }}>
                  <div className="relative aspect-[9/16] overflow-hidden border border-[#f7f2df]/[0.12] bg-black shadow-[0_22px_55px_rgba(0,0,0,0.45)] transition duration-300 group-hover:-translate-y-1 group-hover:border-lime-200/[0.35]">
                    <Image
                      src={pair.out}
                      alt={`${pair.app} finished store screenshot in the gallery wall`}
                      fill
                      sizes="(min-width: 1024px) 220px, (min-width: 640px) 31vw, 46vw"
                      className="object-cover object-top"
                      unoptimized
                    />
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

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white selection:bg-purple-500/30 selection:text-purple-200">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeStructuredData) }} />
      <style>{`
        @keyframes landing-cycle-fade {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          ${LAUNCH_CYCLE_VISIBLE_PERCENT}% { opacity: 1; transform: translateY(0) scale(1); }
          ${LAUNCH_CYCLE_HIDE_PERCENT}% { opacity: 0; transform: translateY(-8px) scale(0.995); }
          100% { opacity: 0; transform: translateY(-8px) scale(0.995); }
        }
        @keyframes landing-cycle-cut {
          0% { opacity: 1; }
          ${LAUNCH_CYCLE_VISIBLE_PERCENT}% { opacity: 1; }
          ${LAUNCH_CYCLE_HIDE_PERCENT}% { opacity: 0; }
          100% { opacity: 0; }
        }
        @keyframes landing-arrow-pulse {
          0% { box-shadow: 0 0 0 0 var(--pulse, rgba(255,255,255,0.32)); }
          70% { box-shadow: 0 0 0 16px rgba(0,0,0,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
        }
        @keyframes landing-rail-drift {
          from { background-position: 0 0; }
          to { background-position: 64px 64px; }
        }
        @keyframes landing-wall-rise {
          from { opacity: 0; transform: translateY(16px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes landing-icon-float {
          0%, 100% { transform: translate3d(0,0,0) rotate(-1deg); }
          50% { transform: translate3d(0,-8px,0) rotate(1deg); }
        }
        @keyframes landing-icon-shine {
          0% { transform: translate3d(-35%,0,0) rotate(12deg); opacity: 0; }
          24% { opacity: 0; }
          36% { opacity: 1; }
          58% { opacity: 0; }
          100% { transform: translate3d(320%,0,0) rotate(12deg); opacity: 0; }
        }
        @keyframes landing-icon-marquee {
          from { transform: translate3d(0,0,0); }
          to { transform: translate3d(-50%,0,0); }
        }
        @keyframes landing-control-flow {
          0% { transform: translate3d(-10px,0,0); opacity: 0; }
          18% { opacity: 1; }
          82% { opacity: 1; }
          100% { transform: translate3d(172px,0,0); opacity: 0; }
        }
        @keyframes landing-approval-breathe {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0), 0 20px 55px rgba(0,0,0,0.32); }
          50% { box-shadow: 0 0 0 5px rgba(52,211,153,0.08), 0 20px 70px rgba(16,185,129,0.12); }
        }
        .cycle-hidden { opacity: 0; }
        .landing-proof-grid { animation: landing-rail-drift 18s linear infinite; }
        .landing-wall-tile { animation: landing-wall-rise 520ms ease-out both; }
        .landing-icon-feature { animation: landing-icon-float 5.8s ease-in-out infinite; }
        .landing-icon-shine { animation: landing-icon-shine 4.2s ease-in-out infinite; }
        .landing-icon-carousel {
          animation: landing-icon-marquee 34s linear infinite;
          will-change: transform;
        }
        .landing-icon-carousel:hover { animation-play-state: paused; }
        .landing-control-flow { animation: landing-control-flow 3.2s ease-in-out infinite; }
        .landing-approval-gate { animation: landing-approval-breathe 4.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .cycle-hidden,
          .landing-proof-grid,
          .landing-wall-tile,
          .landing-icon-feature,
          .landing-icon-shine,
          .landing-icon-carousel,
          .landing-control-flow,
          .landing-approval-gate,
          .landing-pulse-ring {
            animation: none !important;
          }
          .cycle-first .cycle-hidden,
          .cycle-first.cycle-hidden {
            opacity: 1 !important;
          }
        }
      `}</style>
      {/* Starfield Background */}
      <Starfield mode="float" />

      {/* Gradient Overlays */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[1]">
        <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] aura-purple opacity-30 animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] aura-blue opacity-20 animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      {/* Navigation */}
      <header className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-5xl px-4">
        <nav className="glass py-2.5 px-5 rounded-full flex items-center justify-between gap-4 border-white/[0.08] shadow-2xl">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Image
              src="/copilot-icon-72.png"
              alt="App Listing Agent"
              width={22}
              height={22}
              className="w-[22px] h-[22px] flex-shrink-0"
              unoptimized
            />
            <span className="truncate text-[14px] font-bold tracking-tight font-brand text-white">App Listing Agent</span>
          </Link>
          <div className="hidden lg:flex items-center gap-7">
            <Link href="#how-it-works" className="text-[13px] text-white/60 hover:text-white transition-colors whitespace-nowrap">How it works</Link>
            <Link href="#screenshots" className="text-[13px] text-white/60 hover:text-white transition-colors">Screenshots</Link>
            <Link href="#store-pages" className="text-[13px] text-white/60 hover:text-white transition-colors whitespace-nowrap">Store pages</Link>
            <Link href="#pricing" className="text-[13px] text-white/60 hover:text-white transition-colors">Pricing</Link>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <Link
              href="/login"
              className="text-[13px] text-white/60 hover:text-white transition-colors font-medium whitespace-nowrap"
            >
              Log in
            </Link>
            <BookingLink
              href="/book?source=nav"
              source="nav"
              className="hidden text-[13px] font-medium text-white/60 transition-colors hover:text-white md:block whitespace-nowrap"
            >
              Book a setup call
            </BookingLink>
            <TrackedFunnelLink
              href="/login?mode=signup&source=nav"
              source="nav_self_service"
              className="bg-white px-4 py-1.5 text-[13px] font-semibold text-black transition-all hover:bg-neutral-200 active:scale-95 rounded-full whitespace-nowrap"
            >
              Get started
            </TrackedFunnelLink>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="relative pt-44 pb-32 px-6 flex flex-col items-center overflow-hidden">
          <div className="absolute inset-0 z-[-1]">
            {/* Radial glow behind hero text */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-500/5 blur-[120px] rounded-full" />
          </div>

          <div className="mb-8 inline-flex max-w-[calc(100vw-3rem)] items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[12px] font-medium text-white/70 shadow-inner animate-fade-in">
            <span className="flex h-2 w-2 flex-shrink-0 rounded-full bg-purple-500 animate-pulse" />
            <span>Now available for App Store Connect & Google Play</span>
          </div>

          <h1 className="max-w-[22rem] text-center text-[41px] font-bold leading-[1.03] tracking-tight text-gradient animate-fade-up sm:max-w-5xl sm:text-[56px] md:text-[80px]">
            Your App Store listings,<br />
            <span className="text-white/40">on autopilot.</span>
          </h1>

          <p className="mt-8 max-w-[18.5rem] text-center text-[16px] leading-relaxed text-neutral-400 animate-rise sm:max-w-2xl sm:text-[17px] md:text-[19px]" style={{ animationDelay: '0.1s' }}>
            Tell your AI agent what you need for launch. App Listing Agent turns it into finished
            screenshots, localized copy, app icons, custom store pages, and ready-to-approve updates
            for App Store Connect and Google Play.
          </p>

          <div className="mt-10 flex w-full max-w-xl flex-col items-center gap-4 animate-fade-up sm:flex-row sm:justify-center" style={{ animationDelay: '0.2s' }}>
            <TrackedFunnelLink
              href="/login?mode=signup&source=hero"
              source="hero_self_service"
              className="w-full sm:w-auto px-8 py-4 bg-white text-black rounded-full font-bold text-[15px] hover:bg-neutral-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-[0.98] text-center"
            >
              Get started
            </TrackedFunnelLink>
            <BookingLink
              href="/book?source=hero"
              source="hero_guided"
              className="w-full border border-purple-400/25 bg-purple-400/[0.08] px-8 py-4 text-center text-[15px] font-bold text-purple-100 transition-all hover:border-purple-300/40 hover:bg-purple-400/[0.14] active:scale-[0.98] sm:w-auto sm:rounded-full rounded-full"
            >
              Book a setup call
            </BookingLink>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] font-medium">
            <Link href="#how-it-works" className="text-white/40 transition-colors hover:text-white">See how it works ↓</Link>
            <Link href="/audit" className="text-purple-200/80 transition-colors hover:text-white">Get a free listing audit →</Link>
          </div>

          {/* Video sales letter */}
          <div
            className="mt-16 min-w-0 animate-fade-up"
            style={{ animationDelay: '0.25s', width: 'calc(100vw - 2rem)', maxWidth: '56rem' }}
          >
            <VslPlayer />
          </div>

          {/* Agent workflow proof */}
          <div
            className="mt-20 min-w-0 animate-fade-up"
            style={{ animationDelay: '0.3s', width: 'calc(100vw - 2rem)', maxWidth: '48rem' }}
          >
            <div className="relative rounded-2xl border border-white/[0.1] bg-[#080808] overflow-hidden shadow-2xl">
              <div className="flex items-center gap-1.5 px-5 py-3.5 border-b border-white/[0.05] bg-white/[0.02]">
                <div className="w-3 h-3 rounded-full bg-neutral-800" />
                <div className="w-3 h-3 rounded-full bg-neutral-800" />
                <div className="w-3 h-3 rounded-full bg-neutral-800" />
                <span className="ml-3 min-w-0 truncate text-[11px] font-bold uppercase tracking-wider text-neutral-600">Your AI agent · applistingagent MCP</span>
              </div>

              <div className="block p-4 text-left sm:hidden">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-300">You</div>
                  <p className="mt-2 text-[13px] leading-relaxed text-neutral-300">
                    <span className="block">Launch ThreadCam in Germany</span>
                    <span className="block">with localized screenshots,</span>
                    <span className="block">a hoodie campaign page,</span>
                    <span className="block">and updated privacy links.</span>
                  </p>
                </div>

                <div className="mt-4 space-y-2">
                  {[
                    ['translate_metadata', 'German listing copy'],
                    ['generate_screenshot_set', '6 localized screens'],
                    ['create_custom_product_page', 'Hoodie Drops page'],
                    ['update_legal_document', 'privacy + terms links'],
                  ].map(([tool, result]) => (
                    <div key={tool} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-emerald-500">✓</span>
                        <span className="min-w-0 break-words font-mono text-[11px] text-neutral-300">{tool}</span>
                      </div>
                      <div className="mt-1 pl-5 text-[12px] text-neutral-500">{result}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Preview — nothing live yet</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-neutral-400">14 changes ready for review. Approve to send.</div>
                </div>

                <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 text-[13px] font-semibold text-emerald-400">
                  ✓ Approved update complete
                </div>
              </div>

              <div className="hidden min-w-0 p-7 text-left font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere] sm:block">
                <div className="mb-4">
                  <span className="block text-blue-400 sm:inline">You:</span>
                  <span className="mt-1 block break-words text-neutral-300 sm:ml-2 sm:mt-0 sm:inline">
                    Launch ThreadCam in Germany — localized screenshots, a custom page for the hoodie campaign, and updated privacy links.
                  </span>
                </div>

                <div className="space-y-1.5 text-neutral-500">
                  {[
                    ['translate_metadata', 'de-DE title, subtitle, keywords'],
                    ['generate_screenshot_set', '6 screens rendered in German'],
                    ['create_custom_product_page', 'Hoodie Drops'],
                    ['update_legal_document', 'privacy + terms links'],
                  ].map(([tool, result]) => (
                    <div key={tool} className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] gap-2">
                      <span className="text-emerald-500">✓</span>
                      <span className="min-w-0 break-words">
                        {tool} <span className="text-neutral-600">· {result}</span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Preview — nothing live yet</div>
                  <div className="mt-1 text-[13px] text-neutral-400">14 changes ready for review. Approve to send.</div>
                </div>

                <div className="mt-4">
                  <span className="text-blue-400">You:</span>
                  <span className="ml-2 text-neutral-300">approve</span>
                </div>
                <div className="mt-2 text-emerald-500">✓ Approved update complete</div>
              </div>

              <div className="border-t border-white/[0.06] px-4 py-5 sm:px-7">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { name: 'Screenshots', state: '6 de-DE screens', tone: 'text-emerald-400' },
                    { name: 'Custom page', state: 'Hoodie Drops', tone: 'text-emerald-400' },
                    { name: 'Metadata', state: 'German copy ready', tone: 'text-emerald-400' },
                    { name: 'Privacy policy', state: 'Public link ready', tone: 'text-emerald-400' },
                    { name: 'Terms', state: 'Public link ready', tone: 'text-emerald-400' },
                    { name: 'Store update', state: 'Approved', tone: 'text-emerald-400' },
                  ].map((chip) => (
                    <div key={chip.name} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                      <div className="text-[12px] font-semibold text-white/85">{chip.name}</div>
                      <div className={`text-[12px] ${chip.tone}`}>{chip.state}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Curved section divider */}
          <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-black to-transparent" />
        </section>

        {/* Agent Context Section — how it works */}
        <section id="how-it-works" className="relative scroll-mt-24 overflow-hidden bg-black px-6 py-24 md:py-32">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-[-120px] h-[440px] w-[min(860px,100vw)] -translate-x-1/2 rounded-full bg-indigo-500/[0.08] blur-[130px]" />
          </div>

          <div className="relative mx-auto max-w-7xl">
            <div className="mx-auto mb-14 max-w-3xl text-center md:mb-20">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                AGENT-NATIVE
              </div>
              <h2 className="text-4xl font-bold tracking-tight md:text-5xl">
                Your agent already knows your app.<br />
                <span className="text-neutral-500">Now it can ship the store page too.</span>
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-neutral-400">
                The agent you use to build your app has read every screen, release change, and privacy
                detail. App Listing Agent gives it the tools to turn that context into finished
                launch work — you never re-explain your app to a template tool.
              </p>
            </div>

            <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_52px_minmax(0,1.04fr)_52px_minmax(0,1fr)] lg:gap-0">
              {/* What the agent already knows */}
              <div className="min-w-0 rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
                  <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                    Context it already has
                  </span>
                  <span className="whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold text-neutral-400">
                    YOUR CODEBASE
                  </span>
                </div>
                <div className="space-y-1 p-3">
                  {[
                    { icon: Smartphone, label: 'Every screen & flow', detail: 'OnboardingFlow.swift · PaywallView.swift' },
                    { icon: Globe, label: 'Audience & locales', detail: 'Germany launch · de-DE · creator traffic' },
                    { icon: GitCommitHorizontal, label: 'What just changed', detail: 'feat: hoodie mockups + new export flow' },
                    { icon: MessageSquare, label: 'Brand voice & audience', detail: 'onboarding copy, README, tone' },
                    { icon: ShieldCheck, label: 'Privacy & data usage', detail: 'camera, photos — no tracking SDKs' },
                  ].map(({ icon: Icon, label, detail }) => (
                    <div key={label} className="flex min-w-0 items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.03]">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-indigo-400/20 bg-indigo-500/10">
                        <Icon className="h-4 w-4 text-indigo-300" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-white/90">{label}</div>
                        <div className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-neutral-500 [overflow-wrap:anywhere]">
                          {detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connector */}
              <div className="flex items-center justify-center py-1 lg:py-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/10 text-indigo-300 shadow-[0_0_30px_rgba(99,102,241,0.25)]">
                  <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                </div>
              </div>

              {/* App Listing Agent tool calls */}
              <div className="min-w-0 rounded-2xl border border-indigo-400/25 bg-[#0a0a0d] shadow-[0_0_60px_rgba(99,102,241,0.12),0_25px_70px_rgba(0,0,0,0.5)]">
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-5 py-3.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-neutral-800" />
                  <div className="h-2.5 w-2.5 rounded-full bg-neutral-800" />
                  <div className="h-2.5 w-2.5 rounded-full bg-neutral-800" />
                  <span className="ml-2 min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-300">
                    App Listing Agent · one session
                  </span>
                </div>
                <div className="p-5 font-mono text-[12px] leading-relaxed">
                  <div className="mb-3 break-words text-neutral-400 [overflow-wrap:anywhere]">
                    <span className="text-blue-400">You:</span> get the store ready for the hoodie launch
                  </div>
                  <div className="space-y-2 text-neutral-500">
                    {[
                      ['generate_screenshot_set', 'from your real screens'],
                      ['translate_metadata', 'in your brand voice'],
                      ['create_custom_product_page', 'for the campaign'],
                      ['update_legal_document', 'from what you collect'],
                      ['upload_appstore_metadata', 'after your approval'],
                    ].map(([tool, note]) => (
                      <div key={tool} className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] gap-2">
                        <span className="text-emerald-500">✓</span>
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                          {tool} <span className="text-neutral-600">· {note}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-white/[0.06] pt-3 text-[11px] text-neutral-600">
                    No blank brief. No template setup. It already has the context.
                  </div>
                </div>
              </div>

              {/* Connector */}
              <div className="flex items-center justify-center py-1 lg:py-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/10 text-indigo-300 shadow-[0_0_30px_rgba(99,102,241,0.25)]">
                  <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                </div>
              </div>

              {/* What ships to the stores */}
              <div className="flex min-w-0 flex-col rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-2xl">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
                  <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                    Back on your desk
                  </span>
                  <span className="whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold text-neutral-400">
                    STORE-READY
                  </span>
                </div>
                <div className="flex-1 space-y-1 p-3">
                  {[
                    { label: 'Marketing screenshot set', detail: '6 screens, on-brand, per locale' },
                    { label: 'Localized listing copy', detail: 'titles, keywords, descriptions' },
                    { label: 'Custom product page', detail: 'built for the hoodie campaign' },
                    { label: 'App icon & store assets', detail: 'consistent with your brand system' },
                    { label: 'Privacy Policy & Terms', detail: 'public URLs, linked for review' },
                  ].map((row) => (
                    <div key={row.label} className="flex min-w-0 items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.03]">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-white/90">{row.label}</div>
                        <div className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">{row.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/[0.06] p-3">
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Dry run — nothing live yet</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-neutral-400">Everything waits for your approval.</div>
                  </div>
                </div>
              </div>
            </div>

            <p className="mx-auto mt-12 max-w-2xl text-center text-[15px] leading-relaxed text-neutral-500">
              Template and mockup tools start from a blank canvas and make you describe your app all
              over again. <span className="text-neutral-300">Your agent starts from everything it already knows.</span>
            </p>

            {/* The working rhythm, in one line */}
            <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[13px] font-semibold">
              {['Ask', 'Preview', 'Approve', 'Done'].map((step, i) => (
                <span key={step} className="flex items-center gap-3">
                  {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-neutral-700" />}
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-neutral-300">
                    {step}
                  </span>
                </span>
              ))}
              <span className="w-full text-center text-[12px] font-normal text-neutral-600 sm:ml-3 sm:w-auto sm:text-left">
                Every change previews as a dry run before it ships.
              </span>
            </div>
          </div>
        </section>

        <MarketingScreenshotsSection />

        {/* ASO Translations Section */}
        <section className="bg-black px-6 py-32">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  ASO-OPTIMIZED TRANSLATIONS
                </div>
                <h2 className="mb-6 text-4xl font-bold tracking-tight md:text-5xl">
                  Localize your listings<br />
                  <span className="text-neutral-500">without the busywork.</span>
                </h2>
                <p className="mb-8 text-[17px] leading-relaxed text-neutral-400">
                  Your AI agent names the locales; App Listing Agent translates the metadata and re-renders the
                  screenshots in the same pass. Marketing headlines, in-phone labels, and ASO copy
                  stay readable in every language.
                </p>

                <div className="mb-10 space-y-4">
                  {[
                    'Titles, subtitles, descriptions, keywords, release notes',
                    'Localized screenshot text and in-phone UI labels',
                    '39 App Store + 77 Play Store locales supported',
                    'Short-copy controls so translated headlines still fit'
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 text-neutral-300">
                      <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Translation Visual */}
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-purple-500/10 blur-[100px]" />
                <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0a0a0a] p-5 shadow-[0_36px_110px_rgba(0,0,0,0.55)]">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
                    <div className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-purple-500" />
                      <span className="text-[13px] font-semibold text-white/80">Screenshot localization</span>
                    </div>
                    <div className="rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-[11px] font-bold text-neutral-400">
                      ThreadCam / 4 locales
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {localizedScreenshotExamples.map((item) => (
                      <div key={item.code} className="overflow-hidden rounded-2xl border border-purple-300/15 bg-purple-500/[0.04]">
                        <div className="relative aspect-[9/14] bg-white">
                          <Image
                            src={item.screenshot}
                            alt={`ThreadCam ${item.locale} localized App Store screenshot`}
                            fill
                            sizes="(min-width: 1024px) 340px, 45vw"
                            className="object-cover object-top"
                            unoptimized
                          />
                        </div>
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-[12px] font-semibold text-white">{item.locale}</span>
                          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-purple-300">{item.code}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI Icon Generator Section */}
        <section className="py-32 px-6 bg-[#050505]">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Icon Visual */}
              <div className="relative order-2 lg:order-1">
                <div className="absolute inset-0 bg-pink-500/10 blur-[100px] rounded-full" />
                <div className="relative">
                  <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0a0a0a] p-5 shadow-[0_36px_110px_rgba(0,0,0,0.55)]">
                    <div className="grid gap-6 sm:grid-cols-[0.86fr_1.14fr] sm:items-center">
                      <div className="mx-auto w-full max-w-[230px]">
                        <div className="landing-icon-feature relative aspect-square overflow-hidden rounded-[28%] border border-white/20 bg-white/[0.03] shadow-[0_28px_75px_rgba(0,0,0,0.5),0_0_70px_rgba(236,72,153,0.18)]">
                          <Image
                            src={appIconExamples[0].src}
                            alt={`${appIconExamples[0].app} featured app icon`}
                            fill
                            sizes="230px"
                            className="object-cover"
                            unoptimized
                          />
                          <span className="landing-icon-shine pointer-events-none absolute inset-y-[-20%] left-[-75%] w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/55 to-transparent" />
                        </div>
                      </div>

                      <div>
                        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-pink-300/20 bg-pink-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-pink-200">
                          <Palette className="h-3.5 w-3.5" />
                          Icon brief
                        </div>
                        <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                          GymStreak as a friendly AI trainer.
                        </h3>
                        <p className="mt-3 text-[15px] leading-relaxed text-neutral-400">
                          The brief: make a fitness icon that feels coach-like, energetic, and readable at a glance.
                          App Listing Agent turns the app metadata into a polished store-ready direction.
                        </p>
                      </div>
                    </div>

                    <div className="mt-7 border-t border-white/[0.07] pt-5">
                      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                        More from the portfolio
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {appIconExamples.slice(1).map((item) => (
                          <div key={item.app} className="group">
                            <div className="relative aspect-square overflow-hidden rounded-[24%] border border-white/[0.14] bg-white/[0.03] shadow-[0_18px_45px_rgba(0,0,0,0.42)] transition duration-300 group-hover:-translate-y-1 group-hover:border-pink-200/40">
                              <Image
                                src={item.src}
                                alt={`${item.app} app icon`}
                                fill
                                sizes="(min-width: 1024px) 120px, 28vw"
                                className="object-cover"
                                unoptimized
                              />
                            </div>
                            <div className="mt-2 truncate text-center text-[11px] font-semibold text-white/75">
                              {item.app}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="order-1 lg:order-2">
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  AI ICON GENERATOR
                </div>
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
                  Professional app icons.<br />
                  <span className="text-neutral-500">Generated in seconds.</span>
                </h2>
                <p className="text-neutral-400 text-[17px] leading-relaxed mb-8">
                  Describe the app — or let your AI agent build the brief from your metadata — and
                  App Listing Agent returns a polished icon direction you can refine.
                </p>

                <div className="space-y-4 mb-10">
                  {[
                    "Generate from text prompt or app metadata",
                    "Use any App Store icon as style reference",
                    "Refine the chosen direction without starting over"
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 text-neutral-300">
                      <Check className="w-5 h-5 text-pink-500 mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-16 overflow-hidden border-t border-white/[0.07] pt-8">
              <div className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">
                  More app icon work
                </div>
              </div>
              <div
                className="overflow-hidden py-2"
                style={{
                  WebkitMaskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
                  maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
                } as CSSProperties}
              >
                <div className="landing-icon-carousel flex w-max gap-4 pr-4">
                  {[...appIconCarousel, ...appIconCarousel].map((item, i) => {
                    const isDuplicate = i >= appIconCarousel.length
                    return (
                      <div
                        key={`${item.app}-${i}`}
                        aria-hidden={isDuplicate ? true : undefined}
                        className="w-[92px] shrink-0 sm:w-[112px]"
                      >
                        <div className="relative aspect-square overflow-hidden rounded-[24%] border border-white/[0.14] bg-white/[0.03] shadow-[0_20px_48px_rgba(0,0,0,0.42)]">
                          <Image
                            src={item.src}
                            alt={isDuplicate ? '' : `${item.app} app icon`}
                            fill
                            sizes="112px"
                            loading="eager"
                            fetchPriority="low"
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                        <div className="mt-2 truncate text-center text-[11px] font-semibold text-white/70">
                          {item.app}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Custom Store Pages Section */}
        <section id="store-pages" className="scroll-mt-24 border-y border-white/[0.04] bg-black px-6 py-32">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 grid gap-8 lg:grid-cols-[0.84fr_1.16fr] lg:items-end">
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  CUSTOM STORE PAGES
                </div>
                <h2 className="max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
                  Stop sending users to the same store page
                </h2>
              </div>

              <div>
                <p className="mb-6 text-[17px] leading-relaxed text-neutral-400">
                  Apps like ThreadCam send T-shirt searches, hoodie ads, and print-on-demand seller traffic to
                  different store pages. Your AI agent spins up each variant — screenshots, copy, and locales —
                  from one campaign brief.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    'iOS Custom Product Pages and Android Custom Store Listings',
                    'Match screenshots, icons, and feature graphics to each ad angle',
                    'Localize every page variant across your active store locales',
                    'Use the variant URL in Search Ads, creator links, or launches'
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 text-[14px] leading-snug text-neutral-300">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-cyan-500/10 blur-[100px]" />
              <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0a0a0a] p-5 shadow-[0_36px_110px_rgba(0,0,0,0.55)] md:p-7">
                <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="flex min-h-[360px] flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                        Campaign intent
                      </div>
                      <div className="text-2xl font-bold leading-tight text-white">
                        Each click gets a matching page.
                      </div>
                      <p className="mt-4 text-[14px] leading-relaxed text-neutral-500">
                        Search ads, creator links, and launch campaigns can all point at their own store page.
                      </p>
                    </div>

                    <div className="space-y-2">
                      {['T-shirt search', 'Hoodie ad', 'POD seller'].map((item) => (
                        <div key={item} className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 text-[12px] font-semibold text-neutral-400">
                          <span>{item}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-cyan-300" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    {customStorePageVariants.map((item) => (
                      <div key={item.page} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                        <div className="relative aspect-[9/14] border-b border-white/[0.06] bg-black">
                          <Image
                            src={item.screenshot}
                            alt={`${item.page} custom product page screenshot`}
                            fill
                            sizes="(min-width: 1024px) 290px, (min-width: 768px) 30vw, 88vw"
                            className="object-cover object-top"
                            unoptimized
                          />
                        </div>
                        <div className="p-4">
                          <div className="mb-2 inline-flex rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200">
                            {item.angle}
                          </div>
                          <div className="text-[14px] font-semibold text-white">{item.page}</div>
                          <div className="mt-1 min-h-[36px] text-[12px] leading-snug text-neutral-500">
                            {item.intent}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Legal Readiness Section */}
        <section className="py-32 px-6 bg-black border-t border-white/[0.04]">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Legal Docs Visual */}
              <div className="relative order-last lg:order-first">
                <div className="absolute inset-0 bg-violet-500/10 blur-[100px] rounded-full" />
                <div className="relative bg-[#0a0a0a] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
                  <div className="space-y-4">
                    {[
                      {
                        name: 'Privacy Policy',
                        url: 'yourapp.com/privacy',
                        note: 'Written around what your app actually collects',
                      },
                      {
                        name: 'Terms of Service',
                        url: 'yourapp.com/terms',
                        note: 'Covers subscriptions, accounts, and content',
                      },
                    ].map((doc) => (
                      <div key={doc.name} className="flex items-start gap-4 p-4 bg-white/[0.02] rounded-xl border border-white/[0.05]">
                        <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-violet-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-white">{doc.name}</div>
                            <div className="px-3 py-1 bg-violet-500/10 border border-violet-500/20 rounded-full text-[11px] font-bold text-violet-400 whitespace-nowrap">
                              READY
                            </div>
                          </div>
                          <div className="text-[13px] text-neutral-500 truncate">{doc.url}</div>
                          <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">{doc.note}</p>
                        </div>
                      </div>
                    ))}
                    <div className="p-4 bg-violet-500/5 border border-violet-500/20 rounded-xl">
                      <div className="flex items-center gap-2 text-violet-400 text-[13px] font-medium">
                        <Check className="w-4 h-4" />
                        Public links ready for store review
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Legal Copy */}
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  LEGAL, HANDLED
                </div>
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
                  Privacy Policy & Terms,<br />
                  <span className="text-neutral-500">ready for launch review.</span>
                </h2>
                <p className="text-neutral-400 text-[17px] leading-relaxed mb-8">
                  Create the legal pages your launch needs from the same app context your AI agent
                  already has. App Listing Agent drafts a Privacy Policy and Terms of Service,
                  publishes clean public URLs, and keeps them ready for your store listing, review
                  packet, or in-app links.
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px]">
                  <span className="font-semibold text-white">Draft from app context</span>
                  <ArrowRight className="w-4 h-4 text-neutral-600" />
                  <span className="font-semibold text-white">Publish public URLs</span>
                  <ArrowRight className="w-4 h-4 text-neutral-600" />
                  <span className="font-semibold text-white">Link before submission</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Guardrails Section */}
        <section className="relative overflow-hidden border-y border-white/[0.05] bg-[#050505] px-6 py-28 md:py-36">
          <div className="pointer-events-none absolute inset-0 opacity-50" style={{
            backgroundImage: 'radial-gradient(circle at 72% 48%, rgba(16,185,129,0.12), transparent 32%), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: 'auto, 48px 48px, 48px 48px',
          }} />
          <div className="relative mx-auto max-w-7xl">
            <div className="grid items-center gap-16 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />
                  CONTROL PLANE
                </div>
                <h2 className="max-w-xl text-4xl font-bold tracking-tight md:text-5xl md:leading-[1.08]">
                  Give your AI agent store access.<br />
                  <span className="text-neutral-500">Keep every change under review.</span>
                </h2>
                <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-neutral-400">
                  Connect both stores once, then let your agent prepare the work. Credentials stay
                  encrypted, access stays project-scoped, and nothing ships until you approve it.
                </p>

                <div className="mt-9 grid max-w-xl gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-3">
                  {[
                    ['01', 'Official APIs', 'Direct store connections'],
                    ['02', 'Dry run first', 'See the exact diff'],
                    ['03', 'Human approval', 'You decide what ships'],
                  ].map(([step, title, detail]) => (
                    <div key={step} className="bg-[#080808] px-4 py-4">
                      <div className="mb-3 font-mono text-[10px] tracking-[0.18em] text-emerald-300/60">{step}</div>
                      <div className="text-[13px] font-semibold text-white">{title}</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-neutral-500">{detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Guardrails Visual */}
              <div className="relative">
                <div className="pointer-events-none absolute -inset-16 rounded-full bg-emerald-400/[0.08] blur-[110px]" />
                <div className="relative overflow-hidden rounded-[24px] border border-white/[0.1] bg-[#080a09]/95 shadow-[0_36px_120px_rgba(0,0,0,0.72)]">
                  <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4 sm:px-6">
                    <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Live approval route
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-neutral-600">2 stores connected</div>
                  </div>

                  <div className="p-5 sm:p-7">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5">
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Agent request</div>
                        <div className="rounded-full border border-white/[0.08] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-neutral-500">MCP · scoped</div>
                      </div>
                      <p className="max-w-lg text-[15px] leading-relaxed text-neutral-200">
                        “Refresh the launch copy across 30 locales, then show me exactly what will change.”
                      </p>
                    </div>

                    <div className="relative mx-auto h-9 w-[180px] overflow-hidden" aria-hidden="true">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-gradient-to-b from-white/20 to-emerald-400/40" />
                      <span className="landing-control-flow absolute left-0 top-[17px] h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.95)]" />
                    </div>

                    <div className="landing-approval-gate relative rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.055] p-4 sm:p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-emerald-200/20 bg-emerald-300/10 text-emerald-300">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[14px] font-semibold text-white">Approval required</div>
                            <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">Dry run</span>
                          </div>
                          <div className="mt-1.5 text-[12px] leading-relaxed text-neutral-400">30 locale diffs are ready. No store data has been changed.</div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <span className="rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-[11px] font-medium text-neutral-400">Review changes</span>
                            <span className="rounded-lg border border-emerald-300/30 bg-emerald-300 px-3 py-2 text-[11px] font-bold text-[#062018]">Approve update</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mx-auto h-9 w-px bg-gradient-to-b from-emerald-400/40 to-white/15" aria-hidden="true" />

                    {/* Official artwork sources: Apple App Store listing and Google Brand Resource Center. */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]">
                        <img
                          src="https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ff/2a/1e/ff2a1e77-d311-b95c-3307-9379c28f07f9/AppIcon-0-1x_U007epad-0-0-0-1-0-0-sRGB-85-220-0.png/128x128bb.webp"
                          alt="App Store Connect"
                          width="48"
                          height="48"
                          loading="lazy"
                          className="h-12 w-12 flex-none rounded-[12px] shadow-[0_10px_24px_rgba(0,113,227,0.2)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-white">App Store Connect</div>
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-emerald-300/70">
                            <Check className="h-3 w-3" /> API ready
                          </div>
                        </div>
                      </div>
                      <div className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5 transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]">
                        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-[12px] bg-white shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
                          <img
                            src="https://www.gstatic.com/marketing-cms/assets/images/15/b9/77649f194169be94fc4631a785bc/play-symbol.webp"
                            alt="Google Play"
                            width="28"
                            height="31"
                            loading="lazy"
                            className="h-[31px] w-7 object-contain"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-white">Google Play Console</div>
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-emerald-300/70">
                            <Check className="h-3 w-3" /> API ready
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t border-white/[0.07] bg-black/25 px-5 py-3.5 text-[11px] text-neutral-500 sm:px-7">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Encrypted credentials · project-scoped access · complete audit trail
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* MCP Setup Section */}
        <section id="mcp" className="scroll-mt-24 py-32 px-6 bg-black border-t border-white/[0.04]">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                AGENT SETUP
              </div>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
                Add store powers to<br />
                <span className="text-neutral-500">the agent you already use.</span>
              </h2>
              <p className="text-neutral-400 text-[17px] leading-relaxed max-w-2xl mx-auto">
                App Listing Agent is a remote MCP server for Codex, Claude Code, Cursor, and other
                MCP-compatible agents. One endpoint turns screenshots, metadata, app icons, legal,
                and store pages into tools your agent can call.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-stretch">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                  Supported agent surfaces
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { name: "Codex", desc: "App, CLI, IDE extension" },
                    { name: "Claude Code", desc: "Terminal, IDE, desktop, web" },
                    { name: "Cursor", desc: "MCP-compatible IDE" },
                    { name: "Any MCP client", desc: "Remote server support" },
                  ].map((platform) => (
                    <div key={platform.name} className="rounded-xl border border-white/[0.07] bg-black/30 px-4 py-3 transition-colors hover:border-white/[0.16]">
                      <div className="font-semibold text-white">{platform.name}</div>
                      <div className="mt-1 text-[12px] text-neutral-500">{platform.desc}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3 text-[13px] leading-relaxed text-neutral-400">
                  Prefer clicking through the final review? The web dashboard uses the same backend,
                  so agent runs and manual approvals stay in one place.
                </div>
              </div>

              {/* MCP Config Example */}
              <div className="rounded-2xl border border-white/[0.08] bg-[#0a0a0a] p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                      One remote MCP endpoint
                    </div>
                    <div className="mt-1 text-[13px] text-neutral-500">
                      Paste once. Your agent gets store tools immediately.
                    </div>
                  </div>
                  <div className="whitespace-nowrap rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-400">
                    HTTPS MCP
                  </div>
                </div>
                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black p-4 font-mono text-[13px]">
                  <span className="text-neutral-500">{`{`}</span>
                  <br />
                  <span className="text-neutral-500 ml-4">{`"mcpServers": {`}</span>
                  <br />
                  <span className="text-orange-400 ml-8">{`"applistingagent"`}</span><span className="text-neutral-500">: {`{`}</span>
                  <br />
                  <span className="text-blue-400 ml-12">{`"url"`}</span><span className="text-neutral-500">: </span><span className="break-all text-emerald-400">{`"https://applistingagent.com/api/mcp"`}</span>
                  <br />
                  <span className="text-neutral-500 ml-8">{`}`}</span>
                  <br />
                  <span className="text-neutral-500 ml-4">{`}`}</span>
                  <br />
                  <span className="text-neutral-500">{`}`}</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {["Read app context", "Prepare dry runs", "Approve to publish"].map((step) => (
                    <div key={step} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] font-semibold text-neutral-300">
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <PricingSection />

        {/* Final CTA */}
        <section className="py-40 px-6 relative overflow-hidden">
          <div className="absolute inset-0 aura-purple opacity-20 pointer-events-none" />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-5xl md:text-7xl font-bold tracking-tight mb-8">
              Ship your app <span className="text-purple-500">faster.</span>
            </h2>
            <p className="text-xl text-neutral-400 mb-12 max-w-2xl mx-auto">
              Go from app ready to live on the stores in record time.
              Set up in 5 minutes.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <TrackedFunnelLink
                href="/login?mode=signup&source=final_cta"
                source="final_cta_self_service"
                className="inline-flex items-center gap-3 px-10 py-5 bg-white text-black rounded-full font-black text-[17px] hover:bg-neutral-200 transition-all hover:scale-105"
              >
                Get started
                <ArrowRight className="w-5 h-5" />
              </TrackedFunnelLink>
              <BookingLink
                href="/book?source=final_cta"
                source="final_cta_guided"
                className="inline-flex items-center gap-3 rounded-full border border-purple-400/25 bg-purple-400/[0.08] px-10 py-5 text-[17px] font-black text-purple-100 transition-all hover:border-purple-300/40 hover:bg-purple-400/[0.14]"
              >
                Book a setup call
              </BookingLink>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-20 px-6 border-t border-white/[0.05] bg-[#020202]">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10">
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <Image
                src="/copilot-icon-72.png"
                alt="App Listing Agent"
                width={24}
                height={24}
                className="w-6 h-6"
                unoptimized
              />
              <span className="text-[16px] font-bold tracking-tight font-brand">App Listing Agent</span>
            </div>
            <p className="text-neutral-500 text-[14px] leading-relaxed max-w-xs">
              Screenshots, metadata, app icons, legal, and store pages, prepared by your AI agent and approved by you.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-[14px] mb-6">Product</h4>
            <ul className="space-y-4 text-neutral-500 text-[14px]">
              <li><Link href="#how-it-works" className="hover:text-white transition-colors">How it works</Link></li>
              <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
              <li><Link href="/audit" className="hover:text-white transition-colors">Free listing audit</Link></li>
              <li><Link href="/docs/mcp" className="hover:text-white transition-colors">MCP Server</Link></li>
              <li><Link href="/use-cases" className="hover:text-white transition-colors">Use cases</Link></li>
              <li><Link href="/compare/fastlane" className="hover:text-white transition-colors">App Listing Agent vs fastlane</Link></li>
              <li><Link href="/changelog" className="hover:text-white transition-colors">Changelog</Link></li>
              <li><Link href="/appstore-copilot" className="hover:text-white transition-colors">Formerly AppStore Copilot</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-[14px] mb-6">Documentation</h4>
            <ul className="space-y-4 text-neutral-500 text-[14px]">
              <li><Link href="/docs/getting-started" className="hover:text-white transition-colors">Getting Started</Link></li>
              <li><Link href="/docs/mcp/installation" className="hover:text-white transition-colors">Connect an AI agent</Link></li>
              <li><Link href="/docs/mcp/tools" className="hover:text-white transition-colors">Tool reference</Link></li>
              <li><Link href="/docs/authentication" className="hover:text-white transition-colors">Authentication</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-[14px] mb-6">Legal</h4>
            <ul className="space-y-4 text-neutral-500 text-[14px]">
              <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">Contact</Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-20 pt-10 border-t border-white/[0.05] flex flex-col md:flex-row justify-between items-center gap-6">
          <span className="text-neutral-600 text-[12px] font-brand">© {new Date().getFullYear()} App Agentic Ltd. App Listing Agent is operated by App Agentic Ltd.</span>
        </div>
      </footer>
    </div>
  )
}
