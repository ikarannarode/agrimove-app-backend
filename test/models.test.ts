import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Booking, Journey, Notification, Trip, User, Vehicle } from '../src/models';

test('new application records omit the optional legacy ID used by sparse unique indexes', () => {
  for (const Model of [User, Vehicle, Journey, Booking, Trip, Notification]) {
    const record = new Model().toObject();
    assert.equal(Object.hasOwn(record, 'legacySupabaseId'), false, `${Model.modelName} should omit legacySupabaseId`);
  }
});
