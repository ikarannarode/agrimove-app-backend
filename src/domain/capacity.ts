export function remainingCapacity(capacity: number, reservedCapacity: number) {
  if (!Number.isFinite(capacity) || !Number.isFinite(reservedCapacity) || capacity < 0 || reservedCapacity < 0) {
    throw new Error('Capacity values must be finite non-negative numbers.');
  }
  return Math.max(0, capacity - reservedCapacity);
}

export function canReserveCapacity(capacity: number, reservedCapacity: number, requested: number) {
  if (!Number.isFinite(requested) || requested <= 0) return false;
  return requested <= remainingCapacity(capacity, reservedCapacity);
}
