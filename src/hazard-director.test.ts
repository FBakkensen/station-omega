import { describe, expect, it } from 'vitest';
import { createTestGameContext, createTestStation } from '../test/fixtures/factories.js';
import {
    buildStationPressureSnapshot,
    computeHazardDirectorDecision,
    isPersistentHazard,
    isDisruptionEvent,
    buildDisasterContext,
    PERSISTENT_HAZARD_TYPES,
    DISRUPTION_EVENT_TYPES,
    INSTANT_EVENT_TYPES,
} from './hazard-director.js';
import type { ActiveEvent } from './types.js';

function makeEvent(type: ActiveEvent['type'], overrides: Partial<ActiveEvent> = {}): ActiveEvent {
    return {
        type,
        description: `${type} active`,
        minutesRemaining: 10,
        effect: `${type} effect`,
        resolutionHint: '',
        ...overrides,
    };
}

describe('hazard director contracts', () => {
    it('[Z] builds a snapshot with zero hazards and zero failures for a fresh station', () => {
        const { context } = createTestGameContext();
        // Clear system failures for a clean snapshot
        for (const room of context.station.rooms.values()) {
            room.systemFailures = [];
        }
        context.state.activeEvents = [];

        const snapshot = buildStationPressureSnapshot(context.state, context.station);

        expect(snapshot.activeEventCount).toBe(0);
        expect(snapshot.activeHazardCount).toBe(0);
        expect(snapshot.unresolvedFailureCount).toBe(0);
        expect(snapshot.criticalFailureCount).toBe(0);
        expect(snapshot.pressurePhase).toBe('establishing');
        expect(snapshot.playerHpPct).toBe(1);
    });

    it('[O] classifies one persistent hazard correctly in the snapshot', () => {
        const { context } = createTestGameContext();
        context.state.activeEvents = [makeEvent('hull_breach', { roomId: 'room_0' })];

        const snapshot = buildStationPressureSnapshot(context.state, context.station);

        expect(snapshot.activeEventCount).toBe(1);
        expect(snapshot.activeHazardCount).toBe(1);
    });

    it('[M] handles many concurrent events with mixed types in snapshot and decision', () => {
        const { context } = createTestGameContext();
        context.state.activeEvents = [
            makeEvent('hull_breach', { roomId: 'room_0' }),
            makeEvent('atmosphere_alarm', { roomId: 'room_1' }),
            makeEvent('power_failure'),
            makeEvent('fire_outbreak', { roomId: 'room_0' }),
        ];
        context.state.missionElapsedMinutes = 100;

        const snapshot = buildStationPressureSnapshot(context.state, context.station);
        expect(snapshot.activeEventCount).toBe(4);
        expect(snapshot.activeHazardCount).toBe(3); // hull_breach, atmosphere_alarm, fire_outbreak

        const decision = computeHazardDirectorDecision(snapshot, context.state, context.station);
        expect(decision.candidates.length).toBeGreaterThan(0);
        expect(decision.concurrencyLimit).toBeGreaterThanOrEqual(3);
    });

    it('[B] derives correct pressure phase at time boundaries', () => {
        const { context } = createTestGameContext();

        // Early mission
        context.state.missionElapsedMinutes = 10;
        let snapshot = buildStationPressureSnapshot(context.state, context.station);
        expect(snapshot.pressurePhase).toBe('establishing');

        // Building phase
        context.state.missionElapsedMinutes = 50;
        snapshot = buildStationPressureSnapshot(context.state, context.station);
        expect(snapshot.pressurePhase).toBe('building');

        // Crescendo phase
        context.state.missionElapsedMinutes = 130;
        snapshot = buildStationPressureSnapshot(context.state, context.station);
        expect(snapshot.pressurePhase).toBe('crescendo');
    });

    it('[I] preserves type classification for all known event types', () => {
        // Persistent hazard types
        expect(isPersistentHazard('hull_breach')).toBe(true);
        expect(isPersistentHazard('fire_outbreak')).toBe(true);
        expect(isPersistentHazard('radiation_spike')).toBe(true);
        expect(isPersistentHazard('atmosphere_alarm')).toBe(true);
        expect(isPersistentHazard('coolant_leak')).toBe(true);
        expect(isPersistentHazard('structural_alert')).toBe(true);

        // Non-persistent types
        expect(isPersistentHazard('power_failure')).toBe(false);
        expect(isPersistentHazard('distress_signal')).toBe(false);
        expect(isPersistentHazard('supply_cache')).toBe(false);

        // Disruption
        expect(isDisruptionEvent('power_failure')).toBe(true);
        expect(isDisruptionEvent('hull_breach')).toBe(false);

        // All types covered
        expect(PERSISTENT_HAZARD_TYPES.length + DISRUPTION_EVENT_TYPES.length + INSTANT_EVENT_TYPES.length).toBeGreaterThanOrEqual(9);
    });

    it('[E] director safely blocks spawning when at concurrency limit', () => {
        const { context } = createTestGameContext();
        // Fill up active hazards to exceed normal-difficulty limit of 3
        context.state.activeEvents = [
            makeEvent('hull_breach', { roomId: 'room_0' }),
            makeEvent('radiation_spike', { roomId: 'room_0' }),
            makeEvent('atmosphere_alarm', { roomId: 'room_1' }),
            makeEvent('fire_outbreak', { roomId: 'room_1' }),
        ];
        context.state.missionElapsedMinutes = 100;

        const snapshot = buildStationPressureSnapshot(context.state, context.station);
        const decision = computeHazardDirectorDecision(snapshot, context.state, context.station);

        expect(decision.shouldSpawn).toBe(false);
    });

    it('[S] produces standard disaster context string with scenario theme and family', () => {
        const station = createTestStation();
        station.scenario = { theme: 'Cascading hull breach', centralTension: 'Hull fractures are spreading fast' };

        const { context } = createTestGameContext();
        context.station.scenario = station.scenario;

        const snapshot = buildStationPressureSnapshot(context.state, context.station);
        expect(snapshot.disasterFamily).toBe('infrastructure_collapse');

        const ctx = buildDisasterContext(snapshot);
        expect(ctx).toContain('Cascading hull breach');
        expect(ctx).toContain('Infrastructure Collapse');
    });
});
