import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip, Tag, initialsOf, pageNumbers } from './index';

describe('initialsOf', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(initialsOf('Alisher Qodirov')).toBe('AQ');
    expect(initialsOf("Jasur Toshpo'latov Aliyevich")).toBe('JT');
    expect(initialsOf('umar')).toBe('U');
  });

  it('falls back to a dash when there is no name', () => {
    expect(initialsOf(null)).toBe('—');
    expect(initialsOf('')).toBe('—');
  });
});

describe('pageNumbers', () => {
  it('never returns more pages than exist', () => {
    expect(pageNumbers(1, 2)).toEqual([1, 2]);
    expect(pageNumbers(1, 1)).toEqual([1]);
  });

  it('centres the window on the current page', () => {
    expect(pageNumbers(5, 10)).toEqual([4, 5, 6]);
  });

  it('clamps the window at both ends', () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, 3]);
    expect(pageNumbers(10, 10)).toEqual([8, 9, 10]);
  });

  it('treats a zero page count as a single page', () => {
    expect(pageNumbers(1, 0)).toEqual([1]);
  });
});

describe('StatusChip', () => {
  it('renders its label with a leading status dot', () => {
    const { container } = render(<StatusChip tone="accent">Yo&apos;lda</StatusChip>);
    expect(screen.getByText("Yo'lda")).toBeDefined();
    // The pill itself plus the leading dot — both round, the dot 6px square.
    expect(container.querySelectorAll('span.rounded-full')).toHaveLength(2);
    expect(container.querySelector('span.h-1\\.5.w-1\\.5')).not.toBeNull();
  });
});

describe('Tag', () => {
  it('applies the design-system variant class', () => {
    const { container } = render(<Tag variant="outline">Chek</Tag>);
    expect(container.querySelector('.tag.tag-outline')).not.toBeNull();
  });
});
