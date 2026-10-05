import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canReserveCapacity, remainingCapacity } from '../src/domain/capacity';

describe('shared trip capacity', () => {
  it('calculates spare vehicle capacity', () => {
    assert.equal(remainingCapacity(2500, 700), 1800);
  });

  it('does not report negative spare capacity', () => {
    assert.equal(remainingCapacity(1000, 1200), 0);
  });

  it('permits an additional booking only up to the remaining limit', () => {
    assert.equal(canReserveCapacity(2500, 700, 1800), true);
    assert.equal(canReserveCapacity(2500, 700, 1800.01), false);
    assert.equal(canReserveCapacity(2500, 700, 0), false);
  });

  it('rejects invalid capacity values instead of silently accepting them', () => {
    assert.throws(() => remainingCapacity(Number.NaN, 0));
    assert.equal(canReserveCapacity(100, 50, Number.POSITIVE_INFINITY), false);
  });
});
