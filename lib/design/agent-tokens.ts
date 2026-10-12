/**
 * Design tokens for App Listing Agent surfaces that render inside third-party
 * agent hosts (ChatGPT, Claude, Codex) or on the agent-facing web pages.
 *
 * Direction: product violet as the single restrained accent, host-native
 * neutral chrome, system typography, and semantic colour only on state.
 * Every pair is tuned for WCAG AA on its intended background in both schemes.
 */

export interface AgentColorPair {
  light: string
  dark: string
}

export const AGENT_TOKENS = {
  font: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  radius: 16,
  controlRadius: 999,
  controlHeight: 38,

  // Product violet family (globals.css --primary: 263.4 70% 50.4% ≈ #7c3aed).
  accent: { light: '#6d28d9', dark: '#7c3aed' },
  accentHover: { light: '#5b21b6', dark: '#6d28d9' },
  accentText: { light: '#6d28d9', dark: '#a78bfa' },
  accentSoft: { light: '#ede9fe', dark: '#2e1f5e' },
  accentFg: '#ffffff',

  // Neutral, host-native chrome (zinc family, no warm tint).
  surface: { light: '#ffffff', dark: '#1c1c1f' },
  surfaceMuted: { light: '#f4f4f5', dark: '#27272b' },
  border: { light: '#e4e4e7', dark: '#333338' },
  borderStrong: { light: '#d4d4d8', dark: '#48484f' },
  fg: { light: '#18181b', dark: '#f4f4f5' },
  fgSoft: { light: '#3f3f46', dark: '#d4d4d8' },
  muted: { light: '#6b6b74', dark: '#a1a1aa' },
  skeleton: { light: '#ececef', dark: '#2e2e33' },

  // Semantic state colours, used only on the status pill, tags, and dots.
  warn: { light: '#92400e', dark: '#fbbf24' },
  warnBg: { light: '#fef3c7', dark: '#3b2a0a' },
  warnDot: { light: '#d97706', dark: '#f59e0b' },
  ok: { light: '#166534', dark: '#86efac' },
  okBg: { light: '#dcfce7', dark: '#14301c' },
  danger: { light: '#991b1b', dark: '#fca5a5' },
  dangerBg: { light: '#fee2e2', dark: '#3b1414' },
} as const

/** CSS `light-dark()` expression for a colour pair. */
export function lightDark(pair: AgentColorPair): string {
  return `light-dark(${pair.light}, ${pair.dark})`
}
