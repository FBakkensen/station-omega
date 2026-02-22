import { describe, expect, it } from 'vitest';
import {
  checkBidirectional,
  checkConnectivity,
  checkMaterialReachability,
  computeReachableRooms,
  validationFailure,
  validationSuccess,
} from './validate.js';

describe('generation validate helpers', () => {
  it('[Z] returns no bidirectional errors for an empty graph', () => {
    expect(checkBidirectional([])).toEqual([]);
  });

  it('[O] treats a single entry room as fully connected', () => {
    const rooms = [{ id: 'room_0', connections: [] }];
    expect(checkConnectivity(rooms, 'room_0')).toEqual([]);
  });

  it('[M] computes reachability across a multi-room graph', () => {
    const rooms = [
      { id: 'room_0', connections: ['room_1'], lockedBy: null },
      { id: 'room_1', connections: ['room_0', 'room_2'], lockedBy: null },
      { id: 'room_2', connections: ['room_1', 'room_3'], lockedBy: 'keycard_0' },
      { id: 'room_3', connections: ['room_2'], lockedBy: null },
    ];

    expect(computeReachableRooms('room_0', rooms, false)).toEqual(
      new Set(['room_0', 'room_1', 'room_2', 'room_3']),
    );
    expect(computeReachableRooms('room_0', rooms, true)).toEqual(new Set(['room_0', 'room_1']));
  });

  it('[B] marks every room unreachable when entry ID is missing', () => {
    const rooms = [
      { id: 'room_0', connections: ['room_1'] },
      { id: 'room_1', connections: ['room_0'] },
    ];
    expect(checkConnectivity(rooms, 'missing_entry')).toEqual(['room_0', 'room_1']);
  });

  it('[I] preserves ValidationResult contract for success and failure helpers', () => {
    expect(validationSuccess({ id: 'ok' })).toEqual({ success: true, value: { id: 'ok' } });
    expect(validationFailure(['bad input'])).toEqual({ success: false, errors: ['bad input'] });
  });

  it('[E] reports a clear error when required materials are unreachable', () => {
    const rooms = [
      { id: 'room_0', connections: ['room_1'] },
      { id: 'room_1', connections: ['room_0'] },
    ];
    const err = checkMaterialReachability(
      'room_1',
      ['insulated_wire'],
      [{ id: 'item_0', roomId: 'room_9', baseItemKey: 'insulated_wire' }],
      rooms,
      'room_0',
    );

    expect(err).toContain('insulated_wire');
    expect(err).toContain('reachable room');
  });

  it('[S] returns null when required materials are available in reachable rooms', () => {
    const rooms = [
      { id: 'room_0', connections: ['room_1'] },
      { id: 'room_1', connections: ['room_0'] },
    ];

    const err = checkMaterialReachability(
      'room_1',
      ['insulated_wire'],
      [{ id: 'item_0', roomId: 'room_0', baseItemKey: 'insulated_wire' }],
      rooms,
      'room_0',
    );

    expect(err).toBeNull();
  });
});
