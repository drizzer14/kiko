import { appearances } from './appearance';

describe('appearances', () => {
  it('lists system, light, dark in that order', () => {
    expect(appearances).toEqual(['system', 'light', 'dark']);
  });
});
