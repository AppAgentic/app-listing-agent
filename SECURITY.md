# Security Policy

## Reporting a vulnerability

**Please do not report security problems in public GitHub issues, discussions or pull requests.**

Email **security@appagentic.dev** with:

- a description of the problem and its impact,
- steps to reproduce (a proof of concept if you have one),
- the version or commit you tested, and whether it was a self-hosted install or applistingagent.com.

You can also use GitHub's **private vulnerability reporting** ("Report a vulnerability" on the Security tab of this repository).

## What to expect

- We acknowledge reports within 3 working days.
- We send an assessment and a planned fix date within 10 working days.
- We credit you in the release notes when the fix ships, unless you prefer not to be named.

Please give us a reasonable time to fix the problem before you disclose it publicly, and do not access, change or delete data that is not yours while testing. Only test against your own self-hosted install or your own account on applistingagent.com.

## Scope

In scope: this repository's code, including the web app, API routes, MCP server, OAuth and API-key handling, credential encryption and the Cloud Functions workers.

Out of scope: problems in third-party services we integrate with (App Store Connect, Google Play, Firebase, AI providers) unless our code uses them insecurely; denial of service by traffic volume; findings from automated scanners without a working impact.

## Supported versions

We fix security issues on the latest `main`. Self-hosters should update to the latest release.
