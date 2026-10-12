## What does this change?

<!-- One or two sentences. Link the issue it fixes, e.g. "Fixes #123". -->

## Why?

<!-- The problem it solves for users. -->

## How did you test it?

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:run`
- [ ] `npm run build`
- [ ] `(cd functions && npm run build)` if `functions/` changed
- [ ] Manual test (describe below; screenshots for UI changes)

## Checklist

- [ ] Tests added or updated for the behaviour change
- [ ] No secrets, `.env` files, keys or real customer data in the diff
- [ ] Store writes still go through dry-run and owner approval
- [ ] Docs updated (`README.md`, `docs/self-hosting.md`, `.env.example`) if setup or configuration changed
- [ ] I have signed the [CLA](../CLA.md) (the bot will prompt you on your first PR)
