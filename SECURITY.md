# Security Policy

## Reporting a vulnerability

**Do not** open a public issue for a security report. Vulnerability reports go privately to:

📧 **qwerfunch@gmail.com**

Expect an acknowledgement within 7 days. If the report is reproducible and in-scope, the maintainer will work with you on a coordinated disclosure timeline. If it is out-of-scope or duplicate, you will hear back with an explanation.

## What counts as a security issue

The kinds of reports that belong here:

- A reproducible way to **bypass the anti-self-cert guard** so that LLM- or tool-authored evidence alone clears Iron Law stage_4. This is the project's structural integrity invariant; circumventing it is treated as the highest-priority class of report.
- A reproducible way to corrupt the audit log (`.cladding/audit.log.jsonl`) or events log such that an external auditor cannot reconstruct the lifecycle of a feature.
- A way to make a drift detector silently miss a real spec/code/test mismatch (false-negative). False-positives are bugs; false-negatives are security-adjacent because they erode the falsifiability claim.
- Credential or secret exposure in the toolchain (e.g. `stages/secret.ts` failing to redact a known secret pattern).
- Arbitrary code execution through any CLI verb (`clad init`, `clad work`, `clad drive`, `clad sync`, `clad check`, …) against an untrusted spec or workspace.

## What is not in-scope here

- Drift findings that surface a legitimate spec/code mismatch (these are the tool working as designed — open a regular issue).
- Bugs in third-party toolchain binaries (`tsc`, `eslint`, `vitest`, `madge`, `secretlint`, language toolchains). Report those upstream.
- Hardening requests not tied to a concrete vulnerability (open a regular feature request).

## Supported versions

While in `0.x`, only the **latest minor release** receives security fixes. Once `1.0.0` ships, the supported window will be codified in `GOVERNANCE.md`.

| Version | Security fixes |
|---|---|
| 0.1.x | ✅ latest minor |
| < 0.1.0 | ❌ pre-release; no fixes backported |
