"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remainingCapacity = remainingCapacity;
exports.canReserveCapacity = canReserveCapacity;
function remainingCapacity(capacity, reservedCapacity) {
    if (!Number.isFinite(capacity) || !Number.isFinite(reservedCapacity) || capacity < 0 || reservedCapacity < 0) {
        throw new Error('Capacity values must be finite non-negative numbers.');
    }
    return Math.max(0, capacity - reservedCapacity);
}
function canReserveCapacity(capacity, reservedCapacity, requested) {
    if (!Number.isFinite(requested) || requested <= 0)
        return false;
    return requested <= remainingCapacity(capacity, reservedCapacity);
}
