import { LIVE_STRIPE_ACCOUNT_ID } from '@/lib/stripe/config'

/**
 * Self-host mode (open-source distribution, AGPL-3.0): someone runs App Listing Agent on their own
 * Firebase project. Billing is off, every signed-in account has product access and allowances are
 * unlimited. Turned on only by `SELF_HOSTED=true`.
 *
 * Production safety: our hosted cloud must never be flipped into free access by a stray env var. Self-host
 * mode is refused (returns false, logs once) whenever the deployment looks like our live billing
 * deployment: `STRIPE_LIVEMODE=true`, `STRIPE_ACCOUNT_ID` is our live parent Stripe account, or the Firebase
 * project is our hosted one (a local dev session against production Firestore).
 */
type Env = Record<string, string | undefined>

/** Our hosted Firebase/Firestore project. A self-host or local-key session must never write to it. */
export const HOSTED_FIREBASE_PROJECT_ID = 'appstorecopilot'

/** True when this process points at our hosted Firestore (e.g. a local dev session using `.env.example`). */
export function usesHostedFirebaseProject(env: Env = process.env): boolean {
  return [env.FIREBASE_ADMIN_PROJECT_ID, env.NEXT_PUBLIC_FIREBASE_PROJECT_ID]
    .some(value => value?.trim() === HOSTED_FIREBASE_PROJECT_ID)
}

let refusalLogged = false

/** Why self-host mode is refused for this environment, or null when it may run. */
export function selfHostRefusalReason(env: Env = process.env): string | null {
  if (env.STRIPE_LIVEMODE?.trim().toLowerCase() === 'true') {
    return 'STRIPE_LIVEMODE=true (live billing deployment)'
  }
  if (env.STRIPE_ACCOUNT_ID?.trim() === LIVE_STRIPE_ACCOUNT_ID) {
    return 'STRIPE_ACCOUNT_ID is the App Listing Agent live Stripe account'
  }
  if (usesHostedFirebaseProject(env)) {
    return `the Firebase project is the hosted ${HOSTED_FIREBASE_PROJECT_ID} project`
  }
  return null
}

/** True only when `SELF_HOSTED=true` and the production-safety guard does not refuse it. */
export function isSelfHosted(env: Env = process.env): boolean {
  if (env.SELF_HOSTED?.trim().toLowerCase() !== 'true') return false
  const refusal = selfHostRefusalReason(env)
  if (refusal) {
    if (!refusalLogged) {
      refusalLogged = true
      console.error(`[selfhost] SELF_HOSTED=true ignored: ${refusal}. Billing and the paywall stay on.`)
    }
    return false
  }
  return true
}

/** Test hook: lets the once-only refusal log fire again. */
export function resetSelfHostRefusalLogForTests(): void {
  refusalLogged = false
}
