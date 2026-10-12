import type { Metadata } from 'next'

// Sign-in, sign-up, invite and onboarding screens are not search landing pages.
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
