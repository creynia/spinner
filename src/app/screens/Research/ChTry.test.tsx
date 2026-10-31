// Try-it chapter: the candidate buttons, the risk-notice link and the calculator in place.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAPTERS } from './content';
import { data } from './data';
import { ChTry } from './ChTry';
import { candidateLine, CANDIDATE_ORDER, TryIt } from './TryIt';
import * as share from './share';

vi.mock('./share', async (importOriginal) => {
  const orig = await importOriginal<typeof share>();
  return { ...orig, candidateLink: vi.fn(orig.candidateLink) };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const chapter = CHAPTERS.find((c) => c.id === 'try')!;

describe('ChTry', () => {
  it('has the three headings, the buttons, the calculator and the risk-notice link', () => {
    const { container, getByRole } = render(<ChTry chapter={chapter} />);
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'Try a candidate',
      'Build your own ladder',
      'After you run it',
    ]);
    expect(container.querySelectorAll('.research-candidate')).toHaveLength(3);
    expect(container.querySelector('.research-calc')).not.toBeNull();
    const link = getByRole('link', { name: 'Read the risk notice' });
    expect(link.getAttribute('href')).toBe('#/settings?section=about');
    expect(link.classList.contains('link-tap')).toBe(true);
    // no disclaimer text of its own
    expect(container.textContent).not.toMatch(/gambling|not financial advice/i);
  });
});

describe('TryIt', () => {
  it('lists the candidates in plan order, each with its numbers', () => {
    const { container } = render(
      <TryIt candidates={[...data.candidates].reverse()} rows={data.rows} go={() => {}} />,
    );
    const names = [...container.querySelectorAll('.research-candidate-name')].map(
      (n) => n.textContent,
    );
    expect(names).toEqual(
      CANDIDATE_ORDER.map((id) => data.candidates.find((c) => c.id === id)!.name),
    );
    const c9 = data.candidates.find((c) => c.id === CANDIDATE_ORDER[0])!;
    const line = candidateLine(data.rows[c9.rows[0]!]!);
    expect(line).toMatch(/^Typical session \+\$286 · ends ahead 90\.3% · average -\$46/);
    expect(container.textContent).toContain(line);
    expect(container.textContent).toContain('seed 20261031');
    expect(container.textContent).toContain('$5,000 bankroll');
  });

  it('opens a candidate: calls go with a Define link hash', async () => {
    const go = vi.fn();
    const c9 = data.candidates.find((c) => c.id === CANDIDATE_ORDER[0])!;
    const { getByRole } = render(<TryIt candidates={data.candidates} rows={data.rows} go={go} />);
    fireEvent.click(getByRole('button', { name: `Open in Define: ${c9.name}` }));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(go.mock.calls[0]![0]).toMatch(/^#\/define\?d=[A-Za-z0-9_-]+&h=[0-9a-f]{12}$/);
  });

  it('shows the file fallback when the link is too long', async () => {
    const go = vi.fn();
    vi.mocked(share.candidateLink).mockResolvedValueOnce({
      kind: 'file',
      chars: 9123,
      file: '{}',
      filename: 'x.definition.json',
    });
    const { getByRole, container } = render(
      <TryIt candidates={[data.candidates[0]!]} rows={data.rows} go={go} />,
    );
    fireEvent.click(getByRole('button', { name: /Open in Define: / }));
    await waitFor(() => expect(container.textContent).toContain('too long for a link'));
    expect(container.textContent).toContain('9,123 characters');
    expect(getByRole('button', { name: 'Download definition file' })).toBeTruthy();
    expect(go).not.toHaveBeenCalled();
  });

  it('replaces the button by an error when a candidate does not normalize', () => {
    const bad = { ...data.candidates[0]!, strategy: { schema: 1, id: 'x' } };
    const { container, queryByRole } = render(
      <TryIt candidates={[bad]} rows={data.rows} go={() => {}} />,
    );
    expect(queryByRole('button')).toBeNull();
    expect(container.querySelector('p.error')?.textContent).toMatch(
      /^This candidate does not load: .+\.$/,
    );
  });

  it('loads all three candidates', () => {
    const { container, getAllByRole } = render(
      <TryIt candidates={data.candidates} rows={data.rows} go={() => {}} />,
    );
    expect(container.querySelector('p.error')).toBeNull();
    expect(getAllByRole('button')).toHaveLength(3);
  });
});
