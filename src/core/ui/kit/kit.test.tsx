import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  Card,
  MoneyInput,
  Segmented,
  Sheet,
  Stat,
  Tabs,
  Toggle,
  ToastHost,
  clearToasts,
  moneyText,
  parseMoney,
  showToast,
} from '..';

afterEach(() => {
  cleanup();
  clearToasts();
});

describe('money parsing', () => {
  it('parses dollars to integer cents', () => {
    expect(parseMoney('$1,250.50')).toBe(125050);
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('0.5')).toBe(50);
    expect(parseMoney('.5')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1,2,3')).toBeNull();
    expect(parseMoney('1,25')).toBeNull();
    expect(parseMoney('12,34,567')).toBeNull();
    expect(parseMoney('1,234,567.8')).toBe(123456780);
    expect(parseMoney('')).toBeNull();
  });
  it('round-trips', () => {
    for (const c of [0, 5, 100, 2500, 125050]) expect(parseMoney(moneyText(c))).toBe(c);
  });
});

describe('MoneyInput', () => {
  it('reports valid amounts in cents and flags invalid text', () => {
    const onChange = vi.fn();
    const { container } = render(<MoneyInput id="m" value={2500} onChange={onChange} min={2500} />);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('25');
    fireEvent.input(input, { target: { value: '30.25' } });
    expect(onChange).toHaveBeenLastCalledWith(3025);
    fireEvent.input(input, { target: { value: '10' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  it('exposes tablist semantics and moves with arrow keys', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Tabs tabs={tabs} value="a" onChange={onChange} label="Demo">
        <p>panel</p>
      </Tabs>,
    );
    const list = container.querySelector('[role=tablist]')!;
    expect(list.getAttribute('aria-label')).toBe('Demo');
    const items = container.querySelectorAll('[role=tab]');
    expect(items[0]!.getAttribute('aria-selected')).toBe('true');
    expect(items[1]!.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(items[0]!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(container.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe(
      items[0]!.id,
    );
  });
});

describe('Sheet', () => {
  it('renders a labelled modal dialog and closes on Escape', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open title="Pick" onClose={onClose}>
        <button type="button">inside</button>
      </Sheet>,
    );
    const dlg = container.querySelector('[role=dialog]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('Pick');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('only the topmost of nested sheets handles Escape', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Sheet open title="Outer" onClose={outer}>
        <Sheet open title="Inner" onClose={inner}>
          <button type="button">deep</button>
        </Sheet>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
  it('renders nothing when closed', () => {
    const { container } = render(<Sheet open={false} title="x" onClose={() => {}} />);
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });
});

describe('Toggle, Button, Card, Stat', () => {
  it('Toggle is a switch reflecting state', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle label="Sound" checked={false} onChange={onChange} />);
    const sw = container.querySelector('[role=switch]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it('Button renders a link when given href', () => {
    const { container } = render(<Button href="#/x">Go</Button>);
    expect(container.querySelector('a.btn[href="#/x"]')).not.toBeNull();
  });
  it('Card is a section labelled by its heading', () => {
    const { container } = render(<Card title="T">x</Card>);
    const sec = container.querySelector('section')!;
    expect(sec.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')!.id);
  });
  it('Stat shows the interval whenever one is given', () => {
    const { container } = render(
      <Stat label="Mean" value="-$41" interval={{ lo: '-$47', hi: '-$35' }} />,
    );
    expect(container.querySelector('.stat-ci')!.textContent).toContain('-$47');
    expect(container.querySelector('.stat-ci')!.textContent).toContain('-$35');
  });
});

describe('Toasts', () => {
  it('shows in a polite live region and can be dismissed', () => {
    const { container } = render(<ToastHost />);
    expect(container.querySelector('[aria-live=polite]')).not.toBeNull();
    showToast('Saved', { ms: 0 });
    return Promise.resolve().then(async () => {
      await new Promise((r) => setTimeout(r, 0));
      expect(container.querySelectorAll('.toast')).toHaveLength(1);
      fireEvent.click(container.querySelector('button[aria-label=Dismiss]')!);
      await new Promise((r) => setTimeout(r, 0));
      expect(container.querySelectorAll('.toast')).toHaveLength(0);
    });
  });
});

describe('MoneyInput errors', () => {
  it('shows a described error and reverts on blur', () => {
    const { container } = render(<MoneyInput id="m" value={2500} onChange={() => {}} />);
    const input = container.querySelector('input')!;
    fireEvent.input(input, { target: { value: '1,2,3' } });
    const err = container.querySelector('.error')!;
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
    fireEvent.blur(input);
    expect(input.value).toBe('25');
  });
});

describe('Segmented', () => {
  it('has one tab stop and arrows select', () => {
    const onChange = vi.fn();
    const opts = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ] as const;
    const { container } = render(
      <Segmented label="L" value="a" options={opts} onChange={onChange} />,
    );
    const radios = container.querySelectorAll('[role=radio]');
    expect([...radios].map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1']);
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
    fireEvent.keyDown(radios[0]!, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
});

describe('Sheet isolation', () => {
  it('makes the rest inert, locks scroll and restores both; focuses data-autofocus', () => {
    const { container, rerender } = render(
      <div>
        <p id="bg">background</p>
        <Sheet open title="T" onClose={() => {}}>
          <Button autoFocus>Cancel</Button>
        </Sheet>
      </div>,
    );
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.textContent).toBe('Cancel');
    rerender(
      <div>
        <p id="bg">background</p>
        <Sheet open={false} title="T" onClose={() => {}} />
      </div>,
    );
    expect((container.querySelector('#bg') as HTMLElement).inert).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});
