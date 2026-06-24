import { describe, expect, it } from 'vitest';

import { parseSalary } from '../src/utils/salary.mjs';

describe('parseSalary', () => {
  it.each([
    ['15-20K', { min: 15000, max: 20000, months: 12 }],
    ['1-2万', { min: 10000, max: 20000, months: 12 }],
    ['1.5-2万·14薪', { min: 15000, max: 20000, months: 14 }],
    ['12-17k · 14薪', { min: 12000, max: 17000, months: 14 }],
  ])('解析 %s', (input, expected) => expect(parseSalary(input)).toEqual(expected));

  it('无法识别时保留月份并返回空范围', () => {
    expect(parseSalary('面议·13薪')).toEqual({ min: null, max: null, months: 13 });
  });
});
