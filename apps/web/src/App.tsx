import { type FormEvent, useRef, useState } from 'react';
import {
  extractionFromResponse,
  factKeys,
  privateJsonRequest,
  routeFromResponse,
  type Fact,
  type RouteDecision,
} from './api';

type ExtractionState = 'idle' | 'submitting' | 'safe-mode' | 'success';
type RouteState = 'idle' | 'submitting' | 'safe-mode' | 'success';
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
  const [formError, setFormError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const extractionController = useRef<AbortController | null>(null);
  const routeController = useRef<AbortController | null>(null);
  const extractionGeneration = useRef(0);
  const routeGeneration = useRef(0);
  const evidence = evidenceDrafts.map((item) => ({
    ...item,
    kind: 'document_quote' as const,
    page: null,
    sourceLabel: item.sourceLabel.trim(),
    excerpt: item.excerpt.trim(),
  }));

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (evidence.some((item) => !item.sourceLabel || !item.excerpt)) {
      setFormError(
        'Add a source label and an evidence excerpt to every evidence item before continuing.',
      );
      return;
    }
    extractionController.current?.abort();
    const generation = ++extractionGeneration.current;
    setFormError('');
    setExtraction('submitting');
    setRoute(null);
    setRouteState('idle');
    const controller = new AbortController();
    extractionController.current = controller;
    try {
      const response = await fetch('/v1/extractions/facts', {
        ...privateJsonRequest({ evidence }),
        signal: controller.signal,
      });
      const result = extractionFromResponse(await response.json());
      if (generation !== extractionGeneration.current) return;
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
    routeController.current?.abort();
    extractionGeneration.current += 1;
    routeGeneration.current += 1;
    setExtraction('idle');
    setRouteState('idle');
    setRoute(null);
    setFacts([]);
    setSource(null);
  }
  function clearSession() {
    invalidateEvidenceResults();
    setEvidenceDrafts([{ id: 'evidence-1', sourceLabel: '', excerpt: '' }]);
    setNextEvidenceId(2);
    setFormError('');
    setConfirmClear(false);
  }
  async function submitRoute() {
    if (!facts.length || facts.some((fact) => !fact.value.trim())) {
      setFormError('Add a value to every fact you want to check, or remove it.');
      return;
    }
    routeController.current?.abort();
    const generation = ++routeGeneration.current;
    setFormError('');
    setRouteState('submitting');
    setRoute(null);
    const controller = new AbortController();
    routeController.current = controller;
    try {
      const response = await fetch('/v1/routes/prepare', {
        ...privateJsonRequest({ evidence, facts }),
        signal: controller.signal,
      });
      const result = routeFromResponse(await response.json());
      if (generation !== routeGeneration.current) return;
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
        <button className="clear-session" type="button" onClick={() => setConfirmClear(true)}>
          Clear this session
        </button>
      </section>
      {confirmClear ? (
        <section
          aria-describedby="clear-session-detail"
          aria-labelledby="clear-session-title"
          className="confirm-dialog"
          role="alertdialog"
        >
          <h2 id="clear-session-title">Clear all local session data?</h2>
          <p id="clear-session-detail">
            This immediately discards the evidence, reviewed facts, and preparation result currently
            held in this browser.
          </p>
          <button type="button" onClick={clearSession}>
            Clear all local data
          </button>{' '}
          <button type="button" onClick={() => setConfirmClear(false)}>
            Keep working
          </button>
        </section>
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
                  <button
                    type="button"
                    onClick={() =>
                      setFacts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    Remove fact {index + 1}
                  </button>
                  <p className="fact-sources">
                    Sources:{' '}
                    {fact.evidenceIds
                      .map((id) => evidence.find((item) => item.id === id)?.sourceLabel ?? id)
                      .join(', ')}
                  </p>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() =>
                  setFacts((current) => [
                    ...current,
                    {
                      key: 'case_category',
                      value: '',
                      certainty: 'uncertain',
                      evidenceIds: [evidence[0]?.id ?? 'evidence-1'],
                    },
                  ])
                }
              >
                Add fact
              </button>{' '}
              <button disabled={routeState === 'submitting'} type="button" onClick={submitRoute}>
                {routeState === 'submitting' ? 'Checking route…' : 'Check preparation path'}
              </button>
            </div>
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
