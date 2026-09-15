import { act, render, screen } from '@testing-library/react';
import { MagneticBtn, Typewriter } from './Motion';

afterEach(() => jest.useRealTimers());

describe('Typewriter', () => {
  const LINES = ['Zero intrusion. Zero compromise.', 'Real-time threat detection.'];

  /**
   * One character per tick: each timeout sets state, and the *next* timeout is
   * only scheduled once the effect re-runs, so the clock has to be advanced
   * step by step rather than in one jump.
   */
  const type = (chars) => {
    for (let i = 0; i < chars; i++) {
      act(() => {
        jest.advanceTimersByTime(12);
      });
    }
  };

  test('types a whole sentence, not word fragments', () => {
    jest.useFakeTimers();
    const { container } = render(<Typewriter texts={LINES} speed={10} pause={1_000_000} />);

    type(LINES[0].length + 2);

    // The separator used to rejoin/split the text list must not be a character
    // that appears inside the copy, or sentences get shredded into words.
    expect(container.textContent).toContain(LINES[0]);
  });

  test('survives the parent passing a fresh array on every render', () => {
    jest.useFakeTimers();
    const { rerender, container } = render(<Typewriter texts={[...LINES]} speed={10} pause={1_000_000} />);

    type(6);
    // A new array identity with identical contents must NOT reset progress —
    // this is what stalled the animation while the landing page scrolled.
    rerender(<Typewriter texts={[...LINES]} speed={10} pause={1_000_000} />);
    type(LINES[0].length);

    expect(container.textContent).toContain(LINES[0]);
  });
});

describe('MagneticBtn', () => {
  test('forwards style and extra props instead of dropping them', () => {
    render(
      <MagneticBtn style={{ padding: '8px 20px' }} data-testid="cta" aria-label="Launch">
        LAUNCH
      </MagneticBtn>
    );
    const btn = screen.getByTestId('cta');
    expect(btn).toHaveStyle({ padding: '8px 20px' });
    expect(btn).toHaveAttribute('aria-label', 'Launch');
    // A bare <button> defaults to type=submit inside a form.
    expect(btn).toHaveAttribute('type', 'button');
  });

  test('renders an anchor when given href', () => {
    render(<MagneticBtn href="#about">LEARN MORE</MagneticBtn>);
    expect(screen.getByRole('link', { name: 'LEARN MORE' })).toHaveAttribute('href', '#about');
  });
});
