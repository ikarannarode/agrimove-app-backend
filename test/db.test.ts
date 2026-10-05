import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supportsTransactions } from '../src/db';

test('requires a replica set or mongos with logical session support', () => {
  assert.equal(supportsTransactions({ setName: 'rs0', logicalSessionTimeoutMinutes: 30 }), true);
  assert.equal(supportsTransactions({ msg: 'isdbgrid', logicalSessionTimeoutMinutes: 30 }), true);
  assert.equal(supportsTransactions({ logicalSessionTimeoutMinutes: 30 }), false);
  assert.equal(supportsTransactions({ setName: 'rs0' }), false);
});
