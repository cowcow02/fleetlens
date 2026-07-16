# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities **privately** via GitHub Private Vulnerability Reporting (Security Advisories):

**https://github.com/cowcow02/fleetlens/security/advisories/new**

Do **not** open a public issue for security-sensitive bugs. Private reports let us coordinate a fix and publish a GitHub Security Advisory (with CVE assignment when warranted).

Please include:

- Affected component (CLI, dashboard, or team-server) and its version.
- Steps to reproduce, or a proof of concept.
- Impact assessment (data exposure, remote code execution, privilege escalation, denial of service, …).

Response expectations:

- We will acknowledge private reports and keep the reporter informed of remediation progress.
- Please do not disclose the issue publicly until a fix has been released and you have been notified.
- We credit reporters in the published advisory unless they prefer to remain anonymous.

## Scope

Fleetlens is local-first. The **CLI and its bundled dashboard run on the user's own machine** and read local agent transcript files. The **Team Edition team-server is a self-hosted service** (Docker image) that stores shared team data in Postgres.

In scope:

- The `fleetlens` CLI and the local dashboard it serves.
- The `team-server` Docker image and its database/network handling.

Out of scope:

- Vulnerabilities in third-party dependencies not shipped by Fleetlens — report those upstream.
- Issues arising from deploying the dashboard or team-server in an insecure way (e.g. exposed without authentication, unencrypted secrets).

## Supported Versions

We only patch the current line and release fixes to the latest version:

| Track | Supported versions | Distribution |
|---|---|---|
| CLI / dashboard | The **latest released version** on npm (`fleetlens`) | npm |
| Team Edition server | The **latest `server-v*` tagged image** | `ghcr.io/cowcow02/fleetlens-team-server` |

Older versions are not supported. Upgrade with `fleetlens update` (CLI) or by pulling the newest image tag (team-server).
