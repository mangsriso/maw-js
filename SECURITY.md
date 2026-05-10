# Security Policy

## Supported versions

This project is in alpha. Only the latest `alpha` tag (see `package.json`) is supported for security fixes. Older tags will not receive backports.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Email **security@soulbrews.studio** with:

- A description of the vulnerability
- Steps to reproduce (minimal is best)
- The version/tag you observed it on
- Your disclosure timeline expectations

You can expect an acknowledgement within **72 hours** and a coordinated disclosure plan within **7 days**.

## What's in scope

- Command injection / shell escape in `maw` CLI
- Auth bypass on the HTTP API or peer federation transport
- Data exfiltration from the vault (`ψ/`) via crafted config or plugin input
- Supply-chain risks in `packages/*`

## What's out of scope

- Findings that require a malicious local user with shell access
- Self-XSS in the dev UI
- Issues in third-party dependencies without a working maw-js repro
- Alpha APIs labeled `@experimental` that change without notice

## Recognition

We credit reporters in the release notes of the fix tag unless you ask otherwise.
