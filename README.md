# HaqLens Legal

HaqLens Legal helps people in India prepare a clear, evidence-linked next-step packet. It provides legal information and preparation support, never legal advice or automated legal action.

The MVP architecture and safety boundaries are in [the design specification](docs/superpowers/specs/2026-09-14-employment-first-aid-design.md).
The bounded machine-readable endpoint contract is [OpenAPI](docs/openapi.json).
Security controls are documented in [SECURITY.md](SECURITY.md), accessibility guidance in
[ACCESSIBILITY.md](ACCESSIBILITY.md), and the contribution workflow in [CONTRIBUTING.md](CONTRIBUTING.md).
The full challenge-to-feature and verification matrix is in
[docs/CHALLENGE_ALIGNMENT.md](docs/CHALLENGE_ALIGNMENT.md).

## Chosen vertical

HaqLens Legal focuses first on employment and freelancer document preparation in India: offer
letters, contracts, termination notices, payment records, and related evidence. The same workflow
also supports general legal documents through evidence-linked briefs, comparisons, questions, and
official-source guidance.

## Approach and decision logic

The product follows a proof-to-path rule: every displayed fact keeps an evidence origin, while
deterministic code handles segmentation, comparison, redaction, date arithmetic, validation, and
safe routing. Gemini is used only for bounded extraction or explanation when explicitly enabled.
It cannot invent citations, silently confirm transcription, choose an unsupported legal conclusion,
or replace the rule-based safety boundary.

## How it works

1. The user enters evidence or classifies a local file in the browser.
2. The API validates a bounded request and creates an ephemeral in-memory context.
3. Evidence is segmented into labelled excerpts and facts are returned with provenance.
4. Deterministic modules produce comparisons, confirmed dates, routes, redactions, and source links.
5. Grounded questions and optional Gemini extraction return bounded, reviewable results.
6. The user reviews citations and transcription before using or exporting a preparation packet.

## Assumptions and boundaries

- The user supplies truthful, relevant evidence and verifies names, amounts, dates, and citations.
- Official-source links are information resources, not a substitute for professional legal advice.
- The application is stateless by design; it does not provide accounts, case management, filing,
  representation, deadline guarantees, or automated legal action.
- Provider access is opt-in, server-side, bounded, and never receives a browser-held API key.

## Product capabilities

| Capability       | Product behavior                                                                     |
| ---------------- | ------------------------------------------------------------------------------------ |
| Evidence         | Deterministic segmentation with source labels and stable citations                   |
| Preparation      | Briefs, comparisons, grounded questions, redacted packets, and confirmed date checks |
| Official support | Reviewed links from the local official-source manifest                               |
| Documents        | Safe local text intake plus review-gated PDF/image transcription                     |
| Languages        | English and Hindi safety-boundary onboarding                                         |
| Privacy          | No persistence, no browser API key, bounded payloads, and no-store responses         |

## Local development

Prerequisites: Bun `1.4.2` and a current Chromium installation for browser tests.

```sh
bun install
cp .env.example .env
bun run dev:api
bun run dev:web
```

## Hosted deployment

The public web deployment is [haqlens-legal.vercel.app](https://haqlens-legal.vercel.app).
It serves the Vite application and the bounded Hono API from the same origin. The hosted health
endpoint is available at `/api/health`; interactive API routes remain deployment-gated until the
provider’s nested-function routing is finalized. Gemini remains
disabled in the hosted default; enabling it requires a server-side `GEMINI_API_KEY` environment
variable and an explicit provider configuration.

`AI_PROVIDER=disabled` is the safe default. Gemini extraction is enabled only with
`AI_PROVIDER=gemini` and a non-empty `GEMINI_API_KEY`; keep that key only in the ignored local
`.env` file or an equivalent server-side secret store. Never put it in the web app, a commit, a
browser environment variable, or evidence text.

## API privacy and deployment boundary

The API exposes bounded extraction, routing, briefs, comparison, dates, grounded Q&A, reviewed
official-source lookup, and opt-in transcription routes. Existing JSON routes have a 64 KiB request
limit; transcription has a separate 10 MiB limit and remains review-only. All return
`Cache-Control: no-store`. The browser also explicitly sends evidence-bearing requests with
`cache: 'no-store'`. The application does not persist evidence, facts, routes, uploads, accounts, or
analytics data.

Text files can be classified and read locally. PDF/image files require the opt-in Gemini provider
for transcription, and every provider result is returned unconfirmed until the user reviews it
against the original page. The Gemini key is never sent to the browser.

Anonymous write endpoints use an in-memory limit of 30 requests per peer per minute. A rejected
request returns `429`, `{ "error": "rate_limited" }`, and `Retry-After`; it does not parse the body
or invoke Gemini/routing. The table is bounded and expires entries, but is intentionally not a
distributed production rate limiter.

The Bun server uses its direct peer address, never `X-Forwarded-For` or another request-supplied
header. If deployed behind a reverse proxy, do not assume the peer address represents the end user:
add and review an explicit trusted-proxy identity integration first. Do not log evidence text or use
forwarded client identity until that boundary is designed and verified.

## Verification

```sh
bun run verify
bun run build
bun run test:e2e
bun run test:a11y
bun run validate:openapi
```

GitHub Actions runs the quality gate on every pull request and push to `main`. Every pull request
records local checks, security/privacy impact, accessibility impact, and rollback information.
GitGuardian is intentionally waived by project choice; the local secret scanner remains required.
