# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✅ Active development |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues by emailing the maintainer directly or opening a [GitHub Security Advisory](https://github.com/tekron/clawmem/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

You can expect a response within 72 hours.

## Security Model

ClawMem is designed with security and privacy as first-class concerns. See [THREAT-MODEL.md](THREAT-MODEL.md) for the full security analysis.

Key principles:
- **Local-first by default**: no outbound network calls unless you configure a remote endpoint
- **Auditable**: every memory mutation is logged with previous value
- **Reversible**: full version history, point-in-time revert
- **Scoped**: session memory is ephemeral; long-term memory is explicit
