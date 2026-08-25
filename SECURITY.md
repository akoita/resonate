# Security Policy

## Supported versions

Resonate has not made its first supported SemVer release. Until then, the
current `main` branch is supported; older revisions are best-effort only and
are not supported.

## Reporting a vulnerability

Use GitHub private vulnerability reporting from the repository's **Security**
tab as the primary reporting channel. Do not report suspected vulnerabilities
in public issues, discussions, pull requests, or other public channels.

The scope includes:

- smart contracts and deployment or upgrade paths;
- the backend, API, authentication, x402, and MCP surfaces;
- the web frontend and desktop application;
- workers and audio-processing services; and
- CI, release, dependency, and other repository security controls.

The `audit/` directory contains internal review evidence. It is not a
vulnerability-reporting inbox.

Please include the affected component or revision, a concise impact
description, and reproducible steps that use only safe test conditions. Do
not include credentials, tokens, or other secret values in a report.

## Response

We aim to acknowledge a report within 3 business days and complete an initial
triage within 7 business days. While a report is active, we aim to provide a
status update at least every 14 days. Remediation timing depends on severity,
exploitability, affected users, and release complexity.

## Safe testing

Test only against a local instance, a testnet, or accounts and data that you
own. Do not use real-user data, move value, perform destructive or availability
testing, send spam, attempt social engineering, or establish persistence. Stop
testing if third-party data or services could be affected, and report the
impact privately.

There is no bug-bounty or other bounty promise associated with this policy.
