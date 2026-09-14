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

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

afterEach(cleanup);

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
});
