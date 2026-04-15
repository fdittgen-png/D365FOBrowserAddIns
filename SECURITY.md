# Security policy

## Supported versions

This project is pre-1.0 and evolves rapidly. Only the current `main` branch
and the most recent tagged release receive security fixes.

## Reporting a vulnerability

Please do not file a public issue for security vulnerabilities.

Instead, use **GitHub's private vulnerability reporting**:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, reproduction steps, and impact.

You should receive an acknowledgement within 5 business days. We will work
with you to verify, fix, and disclose the issue responsibly.

## Scope

In scope:

- The extension source code in this repository
- The default build output (`dist/`) produced by `npm run build`
- Configuration handling for ticket tracker integrations

Out of scope:

- Vulnerabilities in Dynamics 365 Finance & Operations itself (report those
  to Microsoft)
- Vulnerabilities in third-party ticket systems (OTRS, Jira, Azure DevOps)
- Issues that require physical access to an unlocked device
- Social engineering

## What we care about

- Data exfiltration from the extension's session storage or IndexedDB
- Credential disclosure (tracker system credentials are stored in
  `chrome.storage.local`)
- Cross-site scripting in the review or options pages
- Privilege escalation via the extension's optional host permissions
- Prototype pollution or supply chain issues in build tooling

Thank you for helping keep users safe.
