import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { App } from './App';

const window = new Window({ url: 'http://localhost/' });

Object.assign(globalThis, {
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  navigator: window.navigator,
  window,
});

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

afterEach(cleanup);

function spyOnFetch(response: () => Promise<Response> = async () => new Response()) {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (..._arguments: Parameters<typeof fetch>) => {
      void _arguments;
      requests += 1;
      return response();
    },
    { preconnect: originalFetch.preconnect },
  );

  return {
    requests: () => requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('App component', () => {
  test('renders the local-only safety boundary and bounded evidence controls', () => {
    render(<App />);

    const safetyNotice = screen.getByRole('note').textContent;
    expect(safetyNotice).toContain('legal information and preparation support, not legal advice');
    expect(safetyNotice).toContain('held only in this browser while you use this page');
    expect((screen.getByLabelText('Source label') as HTMLInputElement).maxLength).toBe(120);
    expect((screen.getByLabelText('Evidence excerpt') as HTMLTextAreaElement).maxLength).toBe(
      2_000,
    );
  });

  test('requires confirmation before clearing the in-memory session', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Clear this session' }));
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByRole('alertdialog').getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep working' }));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Clear all local data' }),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep working' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear this session' }));
  });

  test('caps evidence drafts at the extraction contract limit', async () => {
    const user = userEvent.setup();
    render(<App />);

    for (let index = 1; index < 20; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Add evidence' }));
    }

    expect(screen.getAllByRole('group', { name: /^Evidence \d+$/u })).toHaveLength(20);
    expect(screen.queryByRole('button', { name: 'Add evidence' })).toBeNull();
  });

  test('keeps incomplete evidence local instead of requesting extraction', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch();

    try {
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        screen.getByText(
          'Add a source label and an evidence excerpt to every evidence item before continuing.',
        ),
      ).toBeDefined();
      expect(fetchSpy.requests()).toBe(0);
    } finally {
      fetchSpy.restore();
    }
  });

  test('keeps unsafe evidence text local instead of requesting extraction', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch();

    try {
      render(<App />);
      fireEvent.change(screen.getByLabelText('Source label'), {
        target: { value: 'Termination\u0001email' },
      });
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(screen.getByText('Evidence text cannot contain control characters.')).toBeDefined();
      expect(fetchSpy.requests()).toBe(0);
    } finally {
      fetchSpy.restore();
    }
  });

  test('fails closed without rendering extraction transport details', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(async () => {
      throw new Error('provider transport detail must stay private');
    });

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Fact extraction is unavailable' }),
      ).toBeDefined();
      expect(screen.queryByText('provider transport detail must stay private')).toBeNull();
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });

  test('fails closed when an extraction response has malformed JSON', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(
      async () =>
        new Response('{', { headers: { 'content-type': 'application/json' }, status: 200 }),
    );

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Fact extraction is unavailable' }),
      ).toBeDefined();
      expect(screen.queryByText('{')).toBeNull();
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });

  test('shows bounded retry guidance without rendering a rate-limit payload', async () => {
    const user = userEvent.setup();
    const fetchSpy = spyOnFetch(
      async () =>
        new Response('provider payload must stay private', {
          headers: { 'retry-after': '12' },
          status: 429,
        }),
    );

    try {
      render(<App />);
      await user.type(screen.getByLabelText('Source label'), 'Termination email');
      await user.type(screen.getByLabelText('Evidence excerpt'), 'Employment ended today.');
      await user.click(screen.getByRole('button', { name: 'Extract facts for review' }));

      expect(
        await screen.findByRole('heading', { name: 'Please wait before trying again' }),
      ).toBeDefined();
      expect(
        screen.getByText('Try again in about 12 seconds. No facts were generated.'),
      ).toBeDefined();
      expect(screen.queryByText('provider payload must stay private')).toBeNull();
      expect(fetchSpy.requests()).toBe(1);
    } finally {
      fetchSpy.restore();
    }
  });
});
