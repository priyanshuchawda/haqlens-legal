import { type FormEvent, useEffect, useRef, useState } from 'react';
import { segmentTextDocument } from '@h2s/document';
import {
  documentBriefFromResponse,
  documentComparisonFromResponse,
  dateCalculationFromResponse,
  extractionFromResponse,
  factKeys,
  groundedAnswerFromResponse,
  normaliseEvidenceText,
  privateJsonRequest,
  retryAfterSeconds,
  routeFromResponse,
  type Fact,
  type GroundedAnswer,
  type DocumentBrief,
  type DocumentComparison,
  type DateCalculationResult,
  type RouteDecision,
} from './api';

type ExtractionState = 'idle' | 'submitting' | 'safe-mode' | 'rate-limited' | 'success';
type RouteState = 'idle' | 'submitting' | 'safe-mode' | 'rate-limited' | 'success';
type BriefState = 'idle' | 'submitting' | 'safe-mode' | 'success';
type ComparisonState = 'idle' | 'submitting' | 'safe-mode' | 'success';
type DateState = 'idle' | 'submitting' | 'safe-mode' | 'success';
type QuestionState = 'idle' | 'submitting' | 'safe-mode' | 'success';
const factLabel = (key: string) => key.replaceAll('_', ' ');
type EvidenceDraft = Readonly<{ id: string; sourceLabel: string; excerpt: string }>;

export function App() {
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([
    { id: 'evidence-1', sourceLabel: '', excerpt: '' },
  ]);
  const [nextEvidenceId, setNextEvidenceId] = useState(2);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [source, setSource] = useState<'fixture' | 'gemini' | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState>('idle');
  const [route, setRoute] = useState<RouteDecision | null>(null);
  const [routeState, setRouteState] = useState<RouteState>('idle');
  const [brief, setBrief] = useState<DocumentBrief | null>(null);
  const [briefState, setBriefState] = useState<BriefState>('idle');
  const [comparison, setComparison] = useState<DocumentComparison | null>(null);
  const [comparisonState, setComparisonState] = useState<ComparisonState>('idle');
  const [dateResult, setDateResult] = useState<DateCalculationResult | null>(null);
  const [dateState, setDateState] = useState<DateState>('idle');
  const [dateAnchorEvidenceId, setDateAnchorEvidenceId] = useState('evidence-1');
  const [dateAnchorValue, setDateAnchorValue] = useState('');
  const [dateOffsetDays, setDateOffsetDays] = useState('0');
  const [dateConfirmed, setDateConfirmed] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [questionState, setQuestionState] = useState<QuestionState>('idle');
  const [dateFormError, setDateFormError] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const extractionController = useRef<AbortController | null>(null);
  const routeController = useRef<AbortController | null>(null);
  const briefController = useRef<AbortController | null>(null);
  const comparisonController = useRef<AbortController | null>(null);
  const dateController = useRef<AbortController | null>(null);
  const questionController = useRef<AbortController | null>(null);
  const extractionGeneration = useRef(0);
  const routeGeneration = useRef(0);
  const briefGeneration = useRef(0);
  const comparisonGeneration = useRef(0);
  const dateGeneration = useRef(0);
  const questionGeneration = useRef(0);
  const clearSessionTrigger = useRef<HTMLButtonElement | null>(null);
  const clearAllDataButton = useRef<HTMLButtonElement | null>(null);
  const keepWorkingButton = useRef<HTMLButtonElement | null>(null);
  const wasConfirmingClear = useRef(false);
  const evidence = evidenceDrafts.map((item) => ({
    ...item,
    kind: 'document_quote' as const,
    page: null,
    sourceLabel: item.sourceLabel.trim(),
    excerpt: item.excerpt.trim(),
  }));

  useEffect(() => {
    if (confirmClear) {
      wasConfirmingClear.current = true;
      keepWorkingButton.current?.focus();
      const dismissOnEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setConfirmClear(false);
          return;
        }

        if (event.key !== 'Tab') return;
        const firstAction = clearAllDataButton.current;
        const lastAction = keepWorkingButton.current;
        if (firstAction === null || lastAction === null) return;

        if (event.shiftKey && document.activeElement === firstAction) {
          event.preventDefault();
          lastAction.focus();
        } else if (!event.shiftKey && document.activeElement === lastAction) {
          event.preventDefault();
          firstAction.focus();
        }
      };
      document.addEventListener('keydown', dismissOnEscape);
      return () => document.removeEventListener('keydown', dismissOnEscape);
    }

    if (!wasConfirmingClear.current) return;
    wasConfirmingClear.current = false;
    clearSessionTrigger.current?.focus();
  }, [confirmClear]);

  function normalisedEvidence() {
    const prepared = evidence.map((item) => ({
      ...item,
      sourceLabel: normaliseEvidenceText(item.sourceLabel),
      excerpt: normaliseEvidenceText(item.excerpt),
    }));
    return prepared.some((item) => item.sourceLabel === null || item.excerpt === null)
      ? null
      : prepared;
  }
  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preparedEvidence = normalisedEvidence();
    if (preparedEvidence === null) {
      setFormError('Evidence text cannot contain control characters.');
      return;
    }
    if (preparedEvidence.some((item) => !item.sourceLabel || !item.excerpt)) {
      setFormError(
        'Add a source label and an evidence excerpt to every evidence item before continuing.',
      );
      return;
    }
    extractionController.current?.abort();
    const generation = ++extractionGeneration.current;
    setFormError('');
    setRetryAfter(null);
    setExtraction('submitting');
    setRoute(null);
    setRouteState('idle');
    const controller = new AbortController();
    extractionController.current = controller;
    try {
      const response = await fetch('/v1/extractions/facts', {
        ...privateJsonRequest({ evidence: preparedEvidence }),
        signal: controller.signal,
      });
      if (generation !== extractionGeneration.current) return;
      const retry = retryAfterSeconds(response);
      if (retry !== null) {
        setRetryAfter(retry);
        setExtraction('rate-limited');
        return;
      }
      const result = extractionFromResponse(
        await response.json(),
        new Set(preparedEvidence.map((item) => item.id)),
      );
      if (response.ok && result) {
        setFacts(result.facts);
        setSource(result.source);
        setExtraction('success');
        return;
      }
    } catch {
      /* Fail closed without rendering transport or provider details. */
    }
    if (generation !== extractionGeneration.current) return;
    setExtraction('safe-mode');
  }
  function updateFact(index: number, patch: Partial<Fact>) {
    invalidateRouteResult();
    setFacts((current) =>
      current.map((fact, itemIndex) => (itemIndex === index ? { ...fact, ...patch } : fact)),
    );
  }
  function updateEvidence(id: string, patch: Partial<EvidenceDraft>) {
    invalidateEvidenceResults();
    setEvidenceDrafts((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function removeEvidence(id: string) {
    invalidateEvidenceResults();
    setEvidenceDrafts((current) => current.filter((item) => item.id !== id));
    setFacts((current) => current.filter((fact) => !fact.evidenceIds.includes(id)));
  }
  function addEvidence() {
    invalidateEvidenceResults();
    setEvidenceDrafts((current) => [
      ...current,
      { id: `evidence-${nextEvidenceId}`, sourceLabel: '', excerpt: '' },
    ]);
    setNextEvidenceId((current) => current + 1);
  }
  function invalidateEvidenceResults() {
    extractionController.current?.abort();
    extractionGeneration.current += 1;
    setExtraction('idle');
    setFacts([]);
    setSource(null);
    invalidateBriefResult();
    invalidateComparisonResult();
    invalidateDateResult();
    invalidateQuestionResult();
    invalidateRouteResult();
  }
  function invalidateBriefResult() {
    briefController.current?.abort();
    briefGeneration.current += 1;
    setBriefState('idle');
    setBrief(null);
  }
  function invalidateComparisonResult() {
    comparisonController.current?.abort();
    comparisonGeneration.current += 1;
    setComparisonState('idle');
    setComparison(null);
  }
  function invalidateDateResult() {
    dateController.current?.abort();
    dateGeneration.current += 1;
    setDateState('idle');
    setDateResult(null);
    setDateFormError('');
  }
  function invalidateQuestionResult() {
    questionController.current?.abort();
    questionGeneration.current += 1;
    setQuestionState('idle');
    setAnswer(null);
  }
  function invalidateRouteResult() {
    routeController.current?.abort();
    routeGeneration.current += 1;
    setRouteState('idle');
    setRoute(null);
    setRetryAfter(null);
  }
  function clearSession() {
    invalidateEvidenceResults();
    setEvidenceDrafts([{ id: 'evidence-1', sourceLabel: '', excerpt: '' }]);
    setNextEvidenceId(2);
    setFormError('');
    setRetryAfter(null);
    setConfirmClear(false);
  }
  async function submitRoute() {
    const preparedEvidence = normalisedEvidence();
    if (preparedEvidence === null) {
      setFormError('Evidence text cannot contain control characters.');
      return;
    }
    if (!facts.length || facts.some((fact) => !fact.value.trim() || !fact.evidenceIds.length)) {
      setFormError(
        'Add a value and at least one source to every fact you want to check, or remove it.',
      );
      return;
    }
    routeController.current?.abort();
    const generation = ++routeGeneration.current;
    setFormError('');
    setRetryAfter(null);
    setRouteState('submitting');
    setRoute(null);
    const controller = new AbortController();
    routeController.current = controller;
    try {
      const response = await fetch('/v1/routes/prepare', {
        ...privateJsonRequest({ evidence: preparedEvidence, facts }),
        signal: controller.signal,
      });
      if (generation !== routeGeneration.current) return;
      const retry = retryAfterSeconds(response);
      if (retry !== null) {
        setRetryAfter(retry);
        setRouteState('rate-limited');
        return;
      }
      const result = routeFromResponse(await response.json());
      if (response.ok && result) {
        setRoute(result);
        setRouteState('success');
        return;
      }
    } catch {
      /* Fail closed without diagnostics. */
    }
    if (generation !== routeGeneration.current) return;
    setRouteState('safe-mode');
  }
  async function submitBrief() {
    const preparedEvidence = normalisedEvidence();
    const firstEvidence = preparedEvidence?.[0];
    if (
      firstEvidence === undefined ||
      firstEvidence.sourceLabel === null ||
      firstEvidence.excerpt === null
    ) {
      setBriefState('safe-mode');
      return;
    }
    let document;
    try {
      document = segmentTextDocument({
        sourceLabel: firstEvidence.sourceLabel,
        text: firstEvidence.excerpt,
      });
    } catch {
      setBriefState('safe-mode');
      return;
    }
    briefController.current?.abort();
    const generation = ++briefGeneration.current;
    setBrief(null);
    setBriefState('submitting');
    const controller = new AbortController();
    briefController.current = controller;
    try {
      const response = await fetch('/v1/briefs/document', {
        ...privateJsonRequest(document),
        signal: controller.signal,
      });
      if (generation !== briefGeneration.current) return;
      const result = documentBriefFromResponse(await response.json(), document);
      if (response.ok && result) {
        setBrief(result);
        setBriefState('success');
        return;
      }
    } catch {
      /* Fail closed without rendering transport or provider details. */
    }
    if (generation !== briefGeneration.current) return;
    setBriefState('safe-mode');
  }
  async function submitComparison() {
    const preparedEvidence = normalisedEvidence();
    const [leftEvidence, rightEvidence] = preparedEvidence ?? [];
    if (
      leftEvidence === undefined ||
      rightEvidence === undefined ||
      leftEvidence.sourceLabel === null ||
      leftEvidence.excerpt === null ||
      rightEvidence.sourceLabel === null ||
      rightEvidence.excerpt === null
    ) {
      setComparisonState('safe-mode');
      return;
    }
    let left;
    let right;
    try {
      left = segmentTextDocument({
        sourceLabel: leftEvidence.sourceLabel,
        text: leftEvidence.excerpt,
      });
      right = segmentTextDocument({
        sourceLabel: rightEvidence.sourceLabel,
        text: rightEvidence.excerpt,
      });
    } catch {
      setComparisonState('safe-mode');
      return;
    }
    comparisonController.current?.abort();
    const generation = ++comparisonGeneration.current;
    setComparison(null);
    setComparisonState('submitting');
    const controller = new AbortController();
    comparisonController.current = controller;
    try {
      const response = await fetch('/v1/comparisons/document', {
        ...privateJsonRequest({ left, right }),
        signal: controller.signal,
      });
      if (generation !== comparisonGeneration.current) return;
      const result = documentComparisonFromResponse(await response.json(), left, right);
      if (response.ok && result) {
        setComparison(result);
        setComparisonState('success');
        return;
      }
    } catch {
      /* Fail closed without rendering transport or provider details. */
    }
    if (generation !== comparisonGeneration.current) return;
    setComparisonState('safe-mode');
  }
  async function submitDateCalculation() {
    const preparedEvidence = normalisedEvidence();
    const selectedEvidence = preparedEvidence?.find((item) => item.id === dateAnchorEvidenceId);
    const offsetDays = Number(dateOffsetDays);
    if (
      selectedEvidence === undefined ||
      selectedEvidence.sourceLabel === null ||
      selectedEvidence.excerpt === null ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(dateAnchorValue) ||
      !Number.isSafeInteger(offsetDays) ||
      offsetDays < 0 ||
      offsetDays > 3_650
    ) {
      setDateFormError(
        'Choose a source, enter an ISO date, and use a whole-day offset from 0 to 3650.',
      );
      return;
    }
    let document;
    try {
      document = segmentTextDocument({
        sourceLabel: selectedEvidence.sourceLabel,
        text: selectedEvidence.excerpt,
      });
    } catch {
      setDateState('safe-mode');
      return;
    }
    const firstSegment = document.segments[0];
    if (firstSegment === undefined) {
      setDateState('safe-mode');
      return;
    }
    const input = {
      anchor: {
        confirmed: dateConfirmed,
        date: dateAnchorValue,
        citation: { segmentIds: [firstSegment.id] },
      },
      offsetDays,
    };
    dateController.current?.abort();
    const generation = ++dateGeneration.current;
    setDateFormError('');
    setDateResult(null);
    setDateState('submitting');
    const controller = new AbortController();
    dateController.current = controller;
    try {
      const response = await fetch('/v1/dates/calculate', {
        ...privateJsonRequest(input),
        signal: controller.signal,
      });
      if (generation !== dateGeneration.current) return;
      const result = dateCalculationFromResponse(await response.json(), input);
      if (response.ok && result) {
        setDateResult(result);
        setDateState('success');
        return;
      }
    } catch {
      /* Fail closed without rendering transport or provider details. */
    }
    if (generation !== dateGeneration.current) return;
    setDateState('safe-mode');
  }
  async function submitQuestion() {
    const preparedEvidence = normalisedEvidence();
    const firstEvidence = preparedEvidence?.[0];
    if (
      firstEvidence === undefined ||
      firstEvidence.sourceLabel === null ||
      firstEvidence.excerpt === null ||
      !question.trim() ||
      question.trim().length > 1_000
    ) {
      setQuestionState('safe-mode');
      return;
    }
    let document;
    try {
      document = segmentTextDocument({
        sourceLabel: firstEvidence.sourceLabel,
        text: firstEvidence.excerpt,
      });
    } catch {
      setQuestionState('safe-mode');
      return;
    }
    questionController.current?.abort();
    const generation = ++questionGeneration.current;
    setAnswer(null);
    setQuestionState('submitting');
    const controller = new AbortController();
    questionController.current = controller;
    try {
      const response = await fetch('/v1/questions/document', {
        ...privateJsonRequest({ document, question: question.trim() }),
        signal: controller.signal,
      });
      if (generation !== questionGeneration.current) return;
      const result = groundedAnswerFromResponse(await response.json(), document);
      if (response.ok && result) {
        setAnswer(result);
        setQuestionState('success');
        return;
      }
    } catch {
      /* Fail closed without rendering transport details. */
    }
    if (generation !== questionGeneration.current) return;
    setQuestionState('safe-mode');
  }
  return (
    <main className="shell" id="main-content">
      <a className="skip-link" href="#evidence-form">
        Skip to evidence form
      </a>
      <section aria-labelledby="page-title" className="hero">
        <p className="eyebrow">Private prototype</p>
        <h1 id="page-title">Employment and Freelancer First Aid</h1>
        <p className="lede">
          Turn a confusing work dispute into a clear, evidence-linked preparation packet.
        </p>
        <p className="notice" role="note">
          This tool provides legal information and preparation support, not legal advice. Your text
          is held only in this browser while you use this page; document upload is not enabled.
        </p>
        <button
          className="clear-session"
          ref={clearSessionTrigger}
          type="button"
          onClick={() => setConfirmClear(true)}
        >
          Clear this session
        </button>
      </section>
      {confirmClear ? (
        <div className="confirm-backdrop">
          <section
            aria-describedby="clear-session-detail"
            aria-labelledby="clear-session-title"
            aria-modal="true"
            className="confirm-dialog"
            role="alertdialog"
          >
            <h2 id="clear-session-title">Clear all local session data?</h2>
            <p id="clear-session-detail">
              This immediately discards the evidence, reviewed facts, and preparation result
              currently held in this browser.
            </p>
            <button ref={clearAllDataButton} type="button" onClick={clearSession}>
              Clear all local data
            </button>{' '}
            <button ref={keepWorkingButton} type="button" onClick={() => setConfirmClear(false)}>
              Keep working
            </button>
          </section>
        </div>
      ) : null}
      <section aria-labelledby="evidence-title" className="workspace">
        <div>
          <p className="eyebrow">Step 1 of 3</p>
          <h2 id="evidence-title">Add evidence excerpts</h2>
          <p className="supporting-copy">
            Use a short relevant quote. Do not add passwords, bank details, government IDs, or
            anything you would not share with a trusted support person.
          </p>
        </div>
        <form
          aria-describedby={formError ? 'form-error' : undefined}
          id="evidence-form"
          onSubmit={submitEvidence}
        >
          {evidenceDrafts.map((item, index) => (
            <fieldset className="evidence-card" key={item.id}>
              <legend>Evidence {index + 1}</legend>
              <div className="field">
                <label htmlFor={`${item.id}-source`}>Source label</label>
                <input
                  id={`${item.id}-source`}
                  maxLength={120}
                  onChange={(event) => updateEvidence(item.id, { sourceLabel: event.target.value })}
                  placeholder="For example: termination email, 10 February"
                  value={item.sourceLabel}
                />
              </div>
              <div className="field">
                <label htmlFor={`${item.id}-excerpt`}>Evidence excerpt</label>
                <textarea
                  id={`${item.id}-excerpt`}
                  maxLength={2000}
                  onChange={(event) => updateEvidence(item.id, { excerpt: event.target.value })}
                  placeholder="Paste a short factual excerpt."
                  rows={6}
                  value={item.excerpt}
                />
              </div>
              {evidenceDrafts.length > 1 ? (
                <button type="button" onClick={() => removeEvidence(item.id)}>
                  Remove evidence {index + 1}
                </button>
              ) : null}
            </fieldset>
          ))}
          {evidenceDrafts.length < 20 ? (
            <button type="button" onClick={addEvidence}>
              Add evidence
            </button>
          ) : null}
          {formError ? (
            <p className="form-error" id="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button disabled={extraction === 'submitting'} type="submit">
            {extraction === 'submitting' ? 'Checking evidence…' : 'Extract facts for review'}
          </button>
        </form>
        <section aria-atomic="true" aria-live="polite" className="result-panel">
          {extraction === 'idle' ? (
            <p>Nothing is sent until you select “Extract facts for review.”</p>
          ) : null}
          {extraction === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Fact extraction is unavailable</h3>
              <p>
                We have not generated facts from this excerpt. Keep the original evidence and
                consider a qualified local support service.
              </p>
            </div>
          ) : null}
          {extraction === 'rate-limited' ? (
            <div className="safe-mode" role="status">
              <h3>Please wait before trying again</h3>
              <p>Try again in about {retryAfter} seconds. No facts were generated.</p>
            </div>
          ) : null}
          {extraction === 'success' ? (
            <div className="facts">
              <p className="source-status">Extraction source: {source}</p>
              <h3>Step 2 of 3: confirm facts</h3>
              <p>
                Correct or remove every candidate before checking a preparation path. Original
                evidence remains the source of truth.
              </p>
              {facts.map((fact, index) => (
                <fieldset className="fact-card" key={`${fact.key}-${index}`}>
                  <legend>Fact {index + 1}</legend>
                  <label>
                    Type
                    <select
                      aria-label={`Fact ${index + 1} type`}
                      onChange={(event) =>
                        updateFact(index, { key: event.target.value as Fact['key'] })
                      }
                      value={fact.key}
                    >
                      {factKeys.map((key) => (
                        <option key={key} value={key}>
                          {factLabel(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Value
                    <input
                      aria-label={`Fact ${index + 1} value`}
                      maxLength={500}
                      onChange={(event) => updateFact(index, { value: event.target.value })}
                      value={fact.value}
                    />
                  </label>
                  <label>
                    Certainty
                    <select
                      aria-label={`Fact ${index + 1} certainty`}
                      onChange={(event) =>
                        updateFact(index, { certainty: event.target.value as Fact['certainty'] })
                      }
                      value={fact.certainty}
                    >
                      <option value="confirmed">confirmed</option>
                      <option value="uncertain">uncertain</option>
                      <option value="conflicting">conflicting</option>
                    </select>
                  </label>
                  <fieldset className="fact-sources">
                    <legend>Sources for this fact</legend>
                    {evidence.map((item) => (
                      <label key={item.id}>
                        <input
                          checked={fact.evidenceIds.includes(item.id)}
                          onChange={(event) =>
                            updateFact(index, {
                              evidenceIds: event.target.checked
                                ? [...fact.evidenceIds, item.id]
                                : fact.evidenceIds.filter((id) => id !== item.id),
                            })
                          }
                          type="checkbox"
                        />{' '}
                        {item.sourceLabel || `Evidence ${item.id}`}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    type="button"
                    onClick={() => {
                      invalidateRouteResult();
                      setFacts((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    Remove fact {index + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() => {
                  invalidateRouteResult();
                  setFacts((current) => [
                    ...current,
                    {
                      key: 'case_category',
                      value: '',
                      certainty: 'uncertain',
                      evidenceIds: [evidence[0]?.id ?? 'evidence-1'],
                    },
                  ]);
                }}
              >
                Add fact
              </button>{' '}
              <button disabled={briefState === 'submitting'} type="button" onClick={submitBrief}>
                {briefState === 'submitting'
                  ? 'Creating source-linked brief…'
                  : 'Create source-linked excerpt brief'}
              </button>{' '}
              <button
                disabled={comparisonState === 'submitting' || evidence.length < 2}
                type="button"
                onClick={submitComparison}
              >
                {comparisonState === 'submitting'
                  ? 'Comparing source excerpts…'
                  : 'Compare first two evidence excerpts'}
              </button>{' '}
              <button disabled={routeState === 'submitting'} type="button" onClick={submitRoute}>
                {routeState === 'submitting' ? 'Checking route…' : 'Check preparation path'}
              </button>
              <fieldset className="date-calculator">
                <legend>Calculate a confirmed calendar date</legend>
                <p>
                  This adds calendar days only. It does not identify a legal deadline or tell you
                  what action to take.
                </p>
                <label>
                  Date anchor source
                  <select
                    aria-label="Date anchor source"
                    onChange={(event) => {
                      invalidateDateResult();
                      setDateAnchorEvidenceId(event.target.value);
                    }}
                    value={dateAnchorEvidenceId}
                  >
                    {evidence.map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {item.sourceLabel || `Evidence ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  ISO anchor date
                  <input
                    aria-label="ISO anchor date"
                    maxLength={10}
                    onChange={(event) => {
                      invalidateDateResult();
                      setDateAnchorValue(event.target.value);
                    }}
                    placeholder="2026-02-10"
                    value={dateAnchorValue}
                  />
                </label>
                <label>
                  Calendar-day offset
                  <input
                    aria-label="Calendar-day offset"
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(event) => {
                      invalidateDateResult();
                      setDateOffsetDays(event.target.value);
                    }}
                    value={dateOffsetDays}
                  />
                </label>
                <label className="confirmation-control">
                  <input
                    checked={dateConfirmed}
                    onChange={(event) => {
                      invalidateDateResult();
                      setDateConfirmed(event.target.checked);
                    }}
                    type="checkbox"
                  />{' '}
                  I have checked this anchor date against the selected original excerpt.
                </label>
                {dateFormError ? (
                  <p className="form-error" role="alert">
                    {dateFormError}
                  </p>
                ) : null}
                <button
                  disabled={dateState === 'submitting'}
                  type="button"
                  onClick={submitDateCalculation}
                >
                  {dateState === 'submitting'
                    ? 'Calculating calendar date…'
                    : 'Calculate calendar date'}
                </button>
              </fieldset>
              <fieldset className="date-calculator">
                <legend>Ask about the first evidence excerpt</legend>
                <p>
                  Answers quote only a cited excerpt. They do not interpret rights, deadlines, or
                  legal consequences.
                </p>
                <label>
                  Document question
                  <input
                    aria-label="Document question"
                    maxLength={1000}
                    onChange={(event) => {
                      invalidateQuestionResult();
                      setQuestion(event.target.value);
                    }}
                    value={question}
                  />
                </label>
                <button
                  disabled={questionState === 'submitting'}
                  type="button"
                  onClick={submitQuestion}
                >
                  {questionState === 'submitting' ? 'Finding cited excerpt…' : 'Find cited excerpt'}
                </button>
              </fieldset>
            </div>
          ) : null}
          {questionState === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Document answer is unavailable</h3>
              <p>
                No answer was shown. Keep the original excerpt and seek qualified support if needed.
              </p>
            </div>
          ) : null}
          {questionState === 'success' && answer ? (
            <section aria-labelledby="question-result-title" className="document-brief">
              <p className="source-status">Cited document excerpt</p>
              <h3 id="question-result-title">
                {answer.status === 'answered' ? 'Source-linked answer' : 'Human review is needed'}
              </h3>
              {answer.status === 'answered' && answer.citation ? (
                <>
                  <p>{answer.answer}</p>
                  <p>
                    Source:{' '}
                    {answer.citation.segmentIds.map((segmentId, index) => (
                      <span key={segmentId}>
                        {index > 0 ? ', ' : null}first evidence excerpt, segment{' '}
                        {segmentId.replace('segment-', '')}
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                <p>
                  The document did not provide a safe source-exact answer. Review the original
                  excerpt.
                </p>
              )}
            </section>
          ) : null}
          {dateState === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Date calculation is unavailable</h3>
              <p>
                No date was calculated. Keep the source excerpt and seek qualified support if
                needed.
              </p>
            </div>
          ) : null}
          {dateState === 'success' && dateResult ? (
            <section aria-labelledby="date-result-title" className="date-result">
              <p className="source-status">Source-linked calendar calculation</p>
              <h3 id="date-result-title">
                {dateResult.status === 'confirmed'
                  ? 'Confirmed calendar date'
                  : 'Confirmation is needed'}
              </h3>
              {dateResult.status === 'confirmed' ? (
                <p>Calculated date: {dateResult.date}.</p>
              ) : (
                <p>No date is displayed until you explicitly confirm the source anchor.</p>
              )}
              <p>
                Anchor: {dateResult.anchor.date}; offset: {dateResult.offsetDays} calendar days.
              </p>
              <p>This is calendar arithmetic, not a legal deadline or legal advice.</p>
            </section>
          ) : null}
          {briefState === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Source-linked brief is unavailable</h3>
              <p>
                No brief was generated. Keep the original excerpt and review it with qualified local
                support if needed.
              </p>
            </div>
          ) : null}
          {briefState === 'success' && brief ? (
            <section aria-labelledby="brief-title" className="document-brief">
              <p className="source-status">Source-linked excerpt brief</p>
              <h3 id="brief-title">Review the cited excerpt</h3>
              <p>
                This brief is limited to the first evidence excerpt. It is not legal advice and does
                not replace the original document.
              </p>
              <ul>
                {brief.items.map((item, index) => (
                  <li key={`${item.kind}-${index}`}>
                    <p>{item.text}</p>
                    <p>
                      Source:{' '}
                      {item.citation.segmentIds.map((segmentId, citationIndex) => {
                        const segmentIndex = brief.document.segments.findIndex(
                          (segment) => segment.id === segmentId,
                        );
                        return (
                          <span key={segmentId}>
                            {citationIndex > 0 ? ', ' : null}
                            <a href={`#brief-source-${segmentId}`}>
                              {brief.document.sourceLabel}, excerpt {segmentIndex + 1}
                            </a>
                          </span>
                        );
                      })}
                    </p>
                  </li>
                ))}
              </ul>
              {brief.document.segments.map((segment, index) => (
                <blockquote id={`brief-source-${segment.id}`} key={segment.id}>
                  <p>
                    {brief.document.sourceLabel}, excerpt {index + 1}
                  </p>
                  <p>{segment.text}</p>
                </blockquote>
              ))}
            </section>
          ) : null}
          {comparisonState === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Source comparison is unavailable</h3>
              <p>
                No comparison was generated. Keep both original excerpts and compare them with
                qualified local support if needed.
              </p>
            </div>
          ) : null}
          {comparisonState === 'success' && comparison ? (
            <section aria-labelledby="comparison-title" className="document-comparison">
              <p className="source-status">Deterministic source comparison</p>
              <h3 id="comparison-title">Review changes between excerpts</h3>
              <p>
                This identifies text changes only. It does not determine legal meaning, rights, or
                obligations.
              </p>
              {comparison.changes.length === 0 ? (
                <p>No text changes were found after whitespace and case normalization.</p>
              ) : (
                <ol>
                  {comparison.changes.map((change, index) => (
                    <li key={`${change.kind}-${index}`}>
                      <h4>
                        {change.kind === 'added'
                          ? 'Added excerpt'
                          : change.kind === 'removed'
                            ? 'Removed excerpt'
                            : 'Changed excerpt'}
                      </h4>
                      {change.leftSegmentIds ? (
                        <p>
                          Earlier:{' '}
                          {change.leftSegmentIds.map((segmentId, sourceIndex) => {
                            const indexInDocument = comparison.left.segments.findIndex(
                              (segment) => segment.id === segmentId,
                            );
                            return (
                              <span key={segmentId}>
                                {sourceIndex > 0 ? ', ' : null}
                                <a href={`#comparison-left-${segmentId}`}>
                                  {comparison.left.sourceLabel}, excerpt {indexInDocument + 1}
                                </a>
                              </span>
                            );
                          })}
                        </p>
                      ) : null}
                      {change.rightSegmentIds ? (
                        <p>
                          Revised:{' '}
                          {change.rightSegmentIds.map((segmentId, sourceIndex) => {
                            const indexInDocument = comparison.right.segments.findIndex(
                              (segment) => segment.id === segmentId,
                            );
                            return (
                              <span key={segmentId}>
                                {sourceIndex > 0 ? ', ' : null}
                                <a href={`#comparison-right-${segmentId}`}>
                                  {comparison.right.sourceLabel}, excerpt {indexInDocument + 1}
                                </a>
                              </span>
                            );
                          })}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              <div className="comparison-sources">
                <section aria-labelledby="earlier-source-title">
                  <h4 id="earlier-source-title">Earlier source: {comparison.left.sourceLabel}</h4>
                  {comparison.left.segments.map((segment, index) => (
                    <blockquote id={`comparison-left-${segment.id}`} key={segment.id}>
                      <p>Excerpt {index + 1}</p>
                      <p>{segment.text}</p>
                    </blockquote>
                  ))}
                </section>
                <section aria-labelledby="revised-source-title">
                  <h4 id="revised-source-title">Revised source: {comparison.right.sourceLabel}</h4>
                  {comparison.right.segments.map((segment, index) => (
                    <blockquote id={`comparison-right-${segment.id}`} key={segment.id}>
                      <p>Excerpt {index + 1}</p>
                      <p>{segment.text}</p>
                    </blockquote>
                  ))}
                </section>
              </div>
            </section>
          ) : null}
          {routeState === 'safe-mode' ? (
            <div className="safe-mode" role="status">
              <h3>Preparation path is unavailable</h3>
              <p>
                No route has been generated. Keep the original evidence and seek qualified support
                if needed.
              </p>
            </div>
          ) : null}
          {routeState === 'rate-limited' ? (
            <div className="safe-mode" role="status">
              <h3>Please wait before checking a path again</h3>
              <p>Try again in about {retryAfter} seconds. No preparation path was generated.</p>
            </div>
          ) : null}
          {routeState === 'success' && route ? (
            <div className={`route route-${route.status}`} role="status">
              <p className="source-status">Deterministic rule: {route.ruleId}</p>
              <h3>
                {route.status === 'urgent_safety_exit'
                  ? 'Prioritise immediate safety'
                  : route.status === 'human_review_required'
                    ? 'Human review is needed'
                    : route.status === 'insufficient_information'
                      ? 'More facts are needed'
                      : route.status === 'unsupported_scope'
                        ? 'Human handoff is needed'
                        : 'Preparation steps'}
              </h3>
              <ul>
                {route.actions.map((action) => (
                  <li key={action.id}>{action.label}</li>
                ))}
              </ul>
              {route.missingFacts.length ? (
                <p>Missing facts: {route.missingFacts.map(factLabel).join(', ')}.</p>
              ) : null}
              <p>This is preparation information, not legal advice.</p>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
