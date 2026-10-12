# Isolated billing visual review

Run from repository root: `node scripts/billing-review/serve.mjs`.
Preview: `http://127.0.0.1:3137/billing?scenario=free&plan=pro&interval=annual`.

Uses actual BillingClient and BillingPanel, compiled with repo esbuild and Tailwind; navigation hook and API responses are local fixtures. Sidebar is a clearly labelled static fixture, not the authenticated dashboard. Scenarios: free, paid, past_due, pending, success, nonowner. Add `checkout=complete&plan=pro` for pending/success. Actual provider checkout is never opened: fetch is replaced, all POST actions return local 503, CSP denies connections, external/path anchors are intercepted, and server has no proxy or write endpoints. Same-page hash navigation remains active. Requests are inspectable in `window.__fixtureRequests`; render errors in `window.__fixtureError`.

Re-run server after component changes. Output is under node_modules/.cache so Next builds do not delete it. Check port listeners and Tailscale Serve destinations before reusing 3137 in future sessions. Capture through registered appagentic/reviewer gateway; do not use raw browser automation.

2026-09-07 validation: 1440×1200 desktop and 390×844 mobile for all six states; no horizontal overflow in mobile states. 320×740 selection/usage screenshot also passed overflow. Mobile Review plan link lands checkout visibly (section y24, CTA y161 at390). Frequency changed annual to monthly and intercepted checkout POST preserved Pro/monthly; safe failed-checkout message rendered. Pending and nonowner expose no purchase button; past_due exposes recovery; confirmed response produces success banner. These are fixture integration checks, not live payment verification (billing moved to Stripe on 2026-09-17). Evidence: docs/review/assets/billing/.

Final interval check: paid monthly subscription with annual checkout return remains `Confirming your subscription`; matching annual subscription confirms. Mobile sticky review affordance is visible immediately and hash navigation works. Shared browser-use skill was updated with harness isolation/cleanup mechanics learned during this run. Gateway lease released; no disposable browser sessions remain.
