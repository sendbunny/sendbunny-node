# Security

## Reporting a problem

Please do not open a public issue for a security problem.

Report it privately on GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it. We will confirm we received it, keep you updated while we fix it, and credit you in the release notes if you wish.

## Supported versions

Security fixes go into the latest release. Please update to it before reporting.

## How releases are protected

- The package has no runtime dependencies.
- Releases are built and published only by this repository's release workflow on GitHub Actions, using npm trusted publishing. No npm token is stored anywhere.
- npm holds each release until a maintainer approves it with two-step login (staged publishing).
- Every release carries a provenance statement that links it to the exact commit and workflow that built it. Check yours with `npm audit signatures`.
