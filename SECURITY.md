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
- Credential or secret exposure in the toolchain (e.g. `src/stages/secret.ts` failing to redact a known secret pattern).
- Arbitrary code execution through any CLI verb (`clad init`, `clad run`, `clad sync`, `clad check`, `clad serve`, …) against an untrusted spec or workspace.

## MCP server (`clad serve`) — invariants

`clad serve` exposes cladding as an MCP server (v0.2.24+). The following are **structural invariants**, not preferences — a regression on any of these is a security issue and belongs in a private report:

- **No arbitrary shell execution from MCP tools.** Every tool registered on `src/serve/server.ts` delegates to a typed cladding function (`loadSpec`, `runDrift`, `readEvidence`, log readers). None of them shells out, spawn a process, or compile arbitrary user-supplied code. A future tool that needs to execute anything must do it through a constrained, audited interface — never via `child_process.exec` of client-supplied strings.
- **Read-only by default.** v0.2.24 ships four read-only tools (`clad_list_features`, `clad_get_feature`, `clad_run_check`, `clad_get_events`). A future write-capable tool MUST require an explicit `mutating: true` flag in its registration metadata and MUST land a human-pass audit entry in `.cladding/audit.log.jsonl` for every invocation.
- **Sampling responses pass through anti-self-cert.** When the drive loop dispatches through `McpSamplingTransport` (v0.2.25+), the reviewer-vs-author identity barrier (F-049 AC-086) still applies — a host whose client returns the same identity for specialist and reviewer dispatches MUST halt with `HUMAN_REQUIRED`. The MCP boundary is not a bypass.
- **Audit notifications are advisory.** `notifications/resources/updated` for `cladding://audit` (v0.2.25+) is a client-cache-refresh hint, not a substitute for the file-level audit log. The audit log on disk remains the authoritative chain even if every notification is lost.

## What is not in-scope here

- Drift findings that surface a legitimate spec/code mismatch (these are the tool working as designed — open a regular issue).
- Bugs in third-party toolchain binaries (`tsc`, `eslint`, `vitest`, `madge`, `secretlint`, language toolchains). Report those upstream.
- Hardening requests not tied to a concrete vulnerability (open a regular feature request).

## Supported versions

While in `0.x`, only the **latest minor release** receives security fixes. Once `1.0.0` ships, the supported window will be codified in `GOVERNANCE.md`.

| Version | Security fixes |
|---|---|
| Latest `0.x` minor | ✅ receives fixes |
| Any older release | ❌ upgrade to the latest minor |
