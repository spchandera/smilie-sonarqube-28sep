import { describe, it, expect } from 'vitest';
import { convertMoneyToMinorUnits, formatMoney } from '@theme/money-formatting';

describe('convertMoneyToMinorUnits', () => {
  it.each([
    ['1,000.50', 'USD', 100050],
    ['1.000,50', 'EUR', 100050],
    ['1 000.50', 'EUR', 100050],
    ['2,000,000.50', 'USD', 200000050],
    ['2,000,000', 'USD', 200000000],
    ['12.5', 'USD', 1250],
    ['42', 'aud', 4200],
    ['1,500', 'JPY', 1500],
    ['9,500', 'KWD', 9500],
    ['9.5', 'KWD', 9500],
    ['  $19.99  ', 'USD', 1999],
  ])('parses %s %s as %d', (value, currency, expected) => {
    expect(convertMoneyToMinorUnits(value, currency)).toBe(expected);
  });

  it.each([[''], ['   '], ['abc'], [null], [undefined]])('returns null for %j', (value) => {
    expect(convertMoneyToMinorUnits(value, 'USD')).toBeNull();
  });
});

describe('formatMoney', () => {
  const cents = 123456789;

  it.each([
    ['${{amount}}', '$1,234,567.89'],
    ['{{ amount }} AUD', '1,234,567.89 AUD'],
    ['{{amount_no_decimals}}', '1,234,568'],
    ['{{amount_with_comma_separator}}', '1.234.567,89'],
    ['{{amount_no_decimals_with_comma_separator}}', '1.234.568'],
    ['{{amount_no_decimals_with_space_separator}}', '1 234 568'],
    ['{{amount_with_space_separator}}', '1 234 567,89'],
    ['{{amount_with_period_and_space_separator}}', '1 234 567.89'],
    ['{{amount_with_apostrophe_separator}}', "1'234'567.89"],
    ['{{unknown_placeholder}}', '1,234,567.89'],
    ['{{amount}} {{currency}}', '1,234,567.89 USD'],
  ])('formats %s', (format, expected) => {
    expect(formatMoney(cents, format, 'USD')).toBe(expected);
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney(1500, '¥{{amount}}', 'JPY')).toBe('¥1,500');
  });

  it('respects three-decimal currencies', () => {
    expect(formatMoney(9500, '{{amount}}', 'KWD')).toBe('9.500');
  });

  it('formats small and zero values', () => {
    expect(formatMoney(5, '{{amount}}', 'USD')).toBe('0.05');
    expect(formatMoney(0, '{{amount}}', 'USD')).toBe('0.00');
  });

  it('leaves text without placeholders untouched', () => {
    expect(formatMoney(100, 'Free', 'USD')).toBe('Free');
  });
});
