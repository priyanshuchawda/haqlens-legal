# General Indian Legal-Document Assistant — Design

## Decision

H2S expands from Employment and Freelancer First-Aid into a **general Indian legal-document
assistant**. The product may explain a document, compare two versions, identify document-backed
risks, calculate clearly specified dates, answer grounded questions, and prepare a redacted
handoff packet. It provides legal information and preparation support, never legal advice,
outcome prediction, automated filing, or contact with another person or authority.

The product keeps the existing proof-to-path principle: a model can extract or explain; it cannot
invent citations, select an unverified legal route, calculate a deadline from ambiguous text, or
perform an external action.

## Product promise

For a pasted document, PDF, scan, or photograph, a user can:

1. see bounded source segments with stable identifiers;
2. receive a plain-language, source-linked brief;
3. compare a revised document against an earlier one deterministically;
4. review explicitly sourced risks, obligations, and date calculations;
5. ask a document-grounded question with citation requirements; and
6. export a user-reviewed, redacted preparation packet for a qualified professional.

Every displayed factual claim must link to at least one source segment. A legal reference must
come from a reviewed official-source record, never solely from provider text. If a source,
citation, calculation, jurisdiction, or provider response cannot be validated, the UI explains the
limit and offers a safe human-handoff path.

## Scope and non-goals

Initial supported documents are agreements, notices, policies, employment documents, and payment
records relevant to Indian users. A document may be labelled unsupported when its text cannot be
reliably extracted, it exceeds explicit resource limits, or it requires specialist review.

The first release does not provide accounts, permanent document storage, background processing,
automated complaint filing, payment collection, lawyer referrals for payment, broad web search over
user text, or unrestricted legal chat. It does not claim authenticity, legal validity, or a legal
right. It does not silently use a second AI provider.

## Architecture

The existing Bun workspace remains the application shape. New capabilities are isolated in pure
packages and server-only adapters so browser code cannot acquire provider credentials or legal
decision logic.

```text
apps/web (React)                       apps/api (Hono/Bun)
  intake, review, compare, export  ->  policy, upload, orchestration
                                             |
      +------------------------------+-------+-----------------------+
      |                              |                               |
packages/contracts           packages/document                 packages/ai-gemini
strict schemas               sniff/extract/segment             extraction/explanation
      |                              |                               |
packages/core                packages/official-sources         packages/redaction
deterministic routes/dates   reviewed local source manifest     local export transformations
```

### Boundary ownership

| Module             | Owns                                                                         | Must not own                           |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------- |
| `contracts`        | strict request, evidence, citation, analysis, comparison, and export schemas | provider calls, filesystem access, UI  |
| `document`         | file signature recognition, bounded text extraction, segmentation            | model calls, legal conclusions         |
| `official-sources` | versioned reviewed source records and URL allow-list                         | user documents or provider keys        |
| `core`             | deterministic conflict, missing-fact, date, and route logic                  | HTTP, uploads, prompts                 |
| `ai-gemini`        | bounded structured extraction/explanation and failure mapping                | source validation, routing decisions   |
| `redaction`        | deterministic local redaction preview and packet construction                | remote network access                  |
| `api`              | request policy, content limits, orchestration, generic error envelopes       | duplicate domain logic                 |
| `web`              | accessible local-state workflow, user approval, source links                 | secrets, legal decisions, trusted HTML |

## Data flow and retention

1. The browser shows a legal-information boundary and explains processing before an upload or
   pasted text is submitted.
2. The API checks same-origin policy, rate limit, declared and actual byte size, content type,
   magic bytes, page/media limits, and schema before parsing or calling a provider.
3. The document adapter returns bounded text segments. Each has a deterministic `segmentId`,
   source label, page reference when known, and excerpt range.
4. Gemini receives only the bounded text needed for structured extraction or explanation. Document
   content is explicitly treated as data, never instructions.
5. Contracts reject unknown fields, unsupported claim types, unknown segment IDs, duplicate source
   links, unbounded strings, and malformed provider output.
6. Core code computes only deterministic results: comparison alignment, source-link verification,
   missing facts, contradiction state, and dates from explicit user-confirmed anchors.
7. The browser renders citations as local source links and reviewed official-source links. It does
   not render provider HTML or Markdown as trusted content.
8. Source material, facts, results, and exports remain in memory for the session. The user can
   explicitly clear them. A future cache may store only a salted content hash and public official
   sources; it must never store document text, a brief, exports, or provider responses without a
   fresh privacy decision and review.

## Document ingestion policy

The intake API accepts text, PDF, PNG, JPEG, and WebP only after allow-listing by both declared
type and magic bytes. Archives, executables, office macros, encrypted/password-protected files,
and unknown formats are rejected before extraction.

Initial limits are deliberately conservative and are constants covered by tests: maximum request
bytes, maximum pages, maximum rendered-image pixels, maximum extracted characters, maximum
segments, extraction timeout, and concurrent work per request. PDF and OCR work run behind
abortable timeouts. A scan or OCR output is labelled as transcribed and requires user review of
names, amounts, and dates.

No uploaded material is written to disk or logged. A request ID may be logged only with generic
outcome and limit code. Raw filenames, page text, images, prompt text, and provider error bodies
are not loggable fields.

## AI and trust policy

Gemini remains the only enabled provider. Its adapter accepts a pinned allow-listed model name,
bounded request payload, output token cap, abort signal, and strict response schema. A separate
future provider adapter is allowed only after explicit user-visible transfer disclosure and a
security review; it is disabled by default.

The model can emit only:

- candidate summaries, risks, questions, and obligations with segment IDs;
- low/medium/high uncertainty labels;
- search topics for reviewed official sources; and
- comparison explanations for changes already identified by deterministic diffing.

The model cannot emit a route, legal conclusion, statute text, deadline calculation, raw HTML,
external URL, action command, or unsourced claim. Invalid output is dropped at the contract
boundary. Provider failure, timeout, malformed output, or a safety refusal leads to Rule-Only Safe
Mode with original evidence preserved and generic professional-handoff guidance.

## Official legal-source policy

`packages/official-sources` contains a reviewed, versioned manifest of official Indian legal-aid,
employment, consumer, tenancy, and general support sources. Each record has an identifier, title,
jurisdiction, topic tags, authority, canonical HTTPS URL, retrieval/review date, and expiry or
re-review date.

The server never searches the web with document content. It resolves generic, validated topic and
jurisdiction keys against the manifest. A future official API lookup can receive only a generic
topic/jurisdiction query after redaction, must have a host allow-list, response cap, timeout,
version/retrieval metadata, and safe failure behavior. No legal source appears without a visible
authority and link.

## Core capabilities

### Cited brief

The brief groups document-backed facts into plain-language summary, obligations, risks,
uncertainties, missing information, and questions for a professional. Each item references one or
more existing segment IDs. A cited item with no valid segment is discarded rather than rendered.

### Compare

Comparison first segments both documents and aligns clauses deterministically. The model may
explain only additions, removals, and changed pairs returned by the comparator. It cannot claim a
change where the comparator found none. Inputs and output are capped to avoid quadratic unbounded
work.

### Dates

Date arithmetic is deterministic. The UI asks the user to confirm an explicit anchor before it
calculates. Ambiguous, partial, conflicting, or locale-ambiguous date text becomes `needs_human_
review`; no deadline is displayed as fact.

### Grounded Q&A

Questions are bounded, pass an instruction-injection screen, and are only accepted when they are
about the current document. Answers must cite document segment IDs or state that the document does
not cover the question. Q&A cannot browse arbitrary URLs, call tools that mutate state, or answer
from an uncited provider assertion.

### Action packet and export

The browser constructs a packet from user-selected local items: source-linked timeline, facts,
uncertainties, official links, checklist, and questions. A deterministic redaction engine creates a
preview. Export is explicit, local/client initiated, and never uploads a packet. The default export
does not include contact details or original document content.

## Security controls

- `Cache-Control: no-store` for every evidence-bearing response and request.
- CSP, frame denial, referrer policy, content-type sniffing protection, and narrowly scoped
  permissions policy. Production HSTS is enabled only on a controlled HTTPS deployment.
- Same-origin request checks; do not trust request-supplied forwarding headers for client identity.
- Bounded direct-peer rate limiting that fails safely when state is full. A distributed limiter is a
  deployment feature, not an implicit local behavior.
- Strict Zod schemas, actual streaming body limits, generic errors, safe provider timeouts, and
  secret scans for source plus client bundle.
- Dependency lock, audit, reviewable update policy, and documented security reporting path.
- No third-party analytics, fonts, session replay, or browser storage of sensitive case material.

## Accessibility and internationalisation

The workflow supports keyboard-only use, skip navigation, visible focus, accessible errors/live
regions, reduced motion, narrow screens, 200% zoom, high contrast, and print/export preview.
Messages are isolated from components; English is initial language and Hindi is added only with
translation parity tests. Risk is expressed with text and structure, never colour alone.

## Failure behavior

| Situation                                   | Required safe behavior                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Malformed/oversized/disallowed file         | Reject before extraction; give generic corrective guidance        |
| Scan/OCR uncertainty                        | Label transcription and ask for user verification                 |
| Provider timeout, refusal, malformed output | Rule-Only Safe Mode; no provider diagnostics or fake analysis     |
| Unknown citation or official URL            | Drop item/link and show evidence limitation                       |
| Contradictory document facts                | Preserve both source links and require human review               |
| Ambiguous date                              | Do not calculate; request confirmation                            |
| Immediate danger/self-harm/coercion cue     | Exit ordinary flow; show emergency and qualified-support guidance |
| Unsupported document/topic                  | Explain boundary and provide a preparation/handoff checklist      |

## Delivery sequence

Each item is a separately reviewable issue and pull request.

1. Add this architecture and delivery contract.
2. Introduce strict document/segment/citation contracts and pure deterministic segmentation for
   pasted text.
3. Add reviewed official-source manifest, resolver, provenance rendering contract, and tests.
4. Add cited brief contracts and safe fixture provider output; render source-linked brief UI.
5. Add deterministic comparison contracts and engine; render changed-clause review.
6. Add deterministic dates with confirmation and ambiguity handling.
7. Add constrained document-grounded Q&A with citation enforcement and safe refusal.
8. Add action packet, local redaction preview, and export.
9. Add secure PDF/image ingestion, extraction, OCR confidence flow, and adversarial file fixtures.
10. Add Hindi translation parity, responsive/zoom/reduced-motion evidence, final threat model,
    demo scenario, and release report.

### Implementation status (2026-09-19)

Items 1–9 are implemented on `main` through separately merged issues and pull requests. Item 10
is release hardening: the current product has English/Hindi safety-boundary copy, keyboard and
accessibility checks, local redaction, no-persistence controls, and browser evidence, but a final
human review of copy parity and a release validation report remains before public deployment.

Uploads are intentionally after text-first contracts, citations, and action packet behavior. This
lets the most sensitive attack surface reuse tested boundaries rather than forcing product logic
into a file parser.

## Verification contract

Every capability gets unit, contract, API, component, security regression, and browser coverage as
appropriate. Tests include hostile instruction text, unknown/duplicate citations, overlong payloads,
malformed files, ambiguous dates, conflicting facts, provider failure, secret leakage, keyboard
flow, focus, a11y audit, narrow viewport, and no-store behavior.

Before each PR, run the repository’s local format, lint, typecheck, tests, audit, secret scans,
OpenAPI validation, browser/a11y checks, build, and `git diff --check` gates. GitHub Actions remain
disabled by project choice; GitGuardian must pass before merge. No real credential belongs in test
fixtures, commits, PR text, or browser code.

## Definition of done

A reviewer can process a synthetic Indian legal document locally, inspect source-linked output,
compare a revision, safely handle an uncertain scan, reject hostile input, calculate only a
confirmed date, ask a grounded question, review an official source, and export a redacted action
packet. They can also observe safe failure when the provider or a source validation boundary fails.
The product’s legal-information limit and no-persistence behavior remain obvious at every stage.
