/**
 * Minimal typings for the `jsdom` runtime dependency (already installed for the
 * vitest environment) so tests can spin up isolated windows without adding
 * `@types/jsdom`.
 */
declare module 'jsdom' {
  export interface JSDOMOptions {
    runScripts?: 'dangerously' | 'outside-only'
    pretendToBeVisual?: boolean
    url?: string
    beforeParse?(window: Window & typeof globalThis): void
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions)
    readonly window: Window & typeof globalThis
    serialize(): string
  }
}
