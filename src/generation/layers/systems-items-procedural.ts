/**
 * Layer 2: Procedural Systems & Items Generation
 *
 * Replaces the AI-driven Layer 2 with deterministic procedural generation.
 * All thematic data lives in SYSTEM_FAILURE_POOLS — including diagnosisHint
 * and mitigationPaths per template — so the AI was just doing expensive
 * constraint satisfaction that procedural code can do in <1ms with guaranteed
 * correctness on the first pass.
 */

import type { ValidatedTopology } from './topology.js';
import type { ValidatedSystemsItems } from './systems-items.js';
import { SYSTEM_FAILURE_POOLS } from '../../data.js';
import type { SystemFailureTemplate } from '../../data.js';
import { computeReachableRooms, checkMaterialReachability } from '../validate.js';
import { shuffle, pickRandom, randInt } from '../random-utils.js';

// ─── Main Generator ──────────────────────────────────────────────────────────

export function generateSystemsItemsProcedural(
    topology: ValidatedTopology,
    log?: (label: string, content: string) => void,
): ValidatedSystemsItems {
    const { rooms, entryRoomId, escapeRoomId } = topology;

    // Phase 1: Eligible rooms — exclude entry, escape, and archetypes with no failure pool
    const eligible = rooms.filter(r =>
        r.id !== entryRoomId &&
        r.id !== escapeRoomId &&
        SYSTEM_FAILURE_POOLS.has(r.archetype),
    );

    // Phase 2: Select failure rooms — shuffle eligible, take 60-80%
    const failureCount = Math.max(1, randInt(
        Math.ceil(eligible.length * 0.6),
        Math.floor(eligible.length * 0.8),
    ));
    shuffle(eligible);
    const failureRooms = eligible.slice(0, failureCount);

    // Phase 3: Pre-compute severity pool — ~40% sev-1, ~40% sev-2, ~20% sev-3
    // Total failures: each room gets 1-2, estimate total for pool sizing
    const totalFailures = failureRooms.reduce((sum, _, i) => {
        // 70% chance of 1 failure, 30% chance of 2 — but we need exact count
        // We'll decide per-room in phase 4; for the pool, estimate upper bound
        return sum + (i < Math.floor(failureRooms.length * 0.3) ? 2 : 1);
    }, 0);

    const sev3Count = Math.max(1, Math.round(totalFailures * 0.2));
    const sev2Count = Math.round(totalFailures * 0.4);
    const sev1Count = totalFailures - sev2Count - sev3Count;

    const severityPool: Array<1 | 2 | 3> = [
        ...Array.from<1>({ length: sev1Count }).fill(1),
        ...Array.from<2>({ length: sev2Count }).fill(2),
        ...Array.from<3>({ length: sev3Count }).fill(3),
    ];
    shuffle(severityPool);

    // Phase 4: Assign failures
    let sevIdx = 0;
    const roomFailures: ValidatedSystemsItems['roomFailures'] = [];

    for (const room of failureRooms) {
        const templates = SYSTEM_FAILURE_POOLS.get(room.archetype);
        if (!templates || templates.length === 0) continue;

        // 70% chance of 1 failure, 30% chance of 2 (capped by available templates)
        const numFailures = Math.min(
            Math.random() < 0.7 ? 1 : 2,
            templates.length,
        );

        // Pick unique templates
        const shuffledTemplates = shuffle([...templates]);
        const pickedTemplates = shuffledTemplates.slice(0, numFailures);

        const failures = pickedTemplates.map((tmpl: SystemFailureTemplate) => {
            const severity = sevIdx < severityPool.length ? severityPool[sevIdx++] : 1;
            const failureMode = pickRandom(tmpl.failureModes);

            // Phase 5 inline: Assign cascades
            let cascadeTarget: string | null = null;
            let minutesUntilCascade = 0;

            if (severity >= 2) {
                const adjacent = room.connections.filter(
                    c => c !== entryRoomId && c !== escapeRoomId,
                );
                if (adjacent.length > 0) {
                    cascadeTarget = pickRandom(adjacent);
                }
                minutesUntilCascade = severity === 3
                    ? randInt(30, 60)
                    : randInt(60, 120);
            }

            return {
                systemId: tmpl.systemId,
                failureMode,
                severity,
                requiredMaterials: [...tmpl.requiredMaterials],
                requiredSkill: tmpl.requiredSkill,
                diagnosisHint: tmpl.diagnosisHint,
                mitigationPaths: [...tmpl.mitigationPaths],
                cascadeTarget,
                minutesUntilCascade,
            };
        });

        roomFailures.push({ roomId: room.id, failures });
    }

    // Phase 6: Place required materials
    // Rooms eligible for item placement: not entry, not escape
    const itemPlacementRooms = rooms.filter(
        r => r.id !== entryRoomId && r.id !== escapeRoomId,
    );

    const reachable = computeReachableRooms(entryRoomId, rooms);
    const reachablePlacementRooms = itemPlacementRooms.filter(r => reachable.has(r.id));

    let itemCounter = 0;
    const items: ValidatedSystemsItems['items'] = [];

    // Collect all required materials across all failures
    const materialNeeds: Array<{ material: string; failureRoomId: string }> = [];
    for (const rf of roomFailures) {
        for (const f of rf.failures) {
            for (const mat of f.requiredMaterials) {
                materialNeeds.push({ material: mat, failureRoomId: rf.roomId });
            }
        }
    }

    // Round-robin placement across reachable rooms to spread items
    let roomIdx = 0;
    const shuffledPlacementRooms = shuffle([...reachablePlacementRooms]);

    for (const need of materialNeeds) {
        const roomId = shuffledPlacementRooms[roomIdx % shuffledPlacementRooms.length].id;
        roomIdx++;
        items.push({
            id: `${need.material}_${String(itemCounter++)}`,
            roomId,
            baseItemKey: need.material,
            isKeyItem: false,
        });
    }

    // Phase 7: Place keycards for locked doors
    const reachableWithoutLocks = computeReachableRooms(entryRoomId, rooms, true);
    const reachableUnlockedRooms = itemPlacementRooms.filter(
        r => reachableWithoutLocks.has(r.id),
    );

    const uniqueLockIds = new Set(
        rooms.map(r => r.lockedBy).filter((id): id is string => id !== null),
    );
    for (const lockId of uniqueLockIds) {
        // Place one keycard per unique lock ID
        const candidates = reachableUnlockedRooms.length > 0
            ? reachableUnlockedRooms
            : itemPlacementRooms; // fallback: any non-entry/non-escape room
        const keycardRoom = pickRandom(candidates);
        items.push({
            id: lockId,
            roomId: keycardRoom.id,
            baseItemKey: 'keycard',
            isKeyItem: true,
        });
    }

    // Phase 8: Place extras — 3-5 spare items
    const extraKeys = ['stim_injector', 'anti_rad_dose', 'sealant_patch', 'insulated_wire', 'bio_filter'];
    const extraCount = randInt(3, 5);
    for (let i = 0; i < extraCount; i++) {
        const key = pickRandom(extraKeys);
        const roomId = pickRandom(shuffledPlacementRooms).id;
        items.push({
            id: `${key}_${String(itemCounter++)}`,
            roomId,
            baseItemKey: key,
            isKeyItem: false,
        });
    }

    // Phase 9: Sanity check — belt-and-suspenders reachability validation
    const errors: string[] = [];
    for (const rf of roomFailures) {
        for (const f of rf.failures) {
            const err = checkMaterialReachability(
                rf.roomId,
                f.requiredMaterials,
                items,
                rooms,
                entryRoomId,
            );
            if (err) errors.push(err);
        }
    }

    if (errors.length > 0) {
        log?.('PROCEDURAL-L2-WARN', `Reachability issues (should not happen): ${errors.join('; ')}`);
    }

    // Log summary
    const bySeverity = { 1: 0, 2: 0, 3: 0 };
    for (const rf of roomFailures) {
        for (const f of rf.failures) bySeverity[f.severity]++;
    }
    log?.('PROCEDURAL-L2', [
        `Failures: ${String(bySeverity[1])} sev-1, ${String(bySeverity[2])} sev-2, ${String(bySeverity[3])} sev-3`,
        `Items: ${String(items.length)} total across ${String(new Set(items.map(i => i.roomId)).size)} rooms`,
        `Failure rooms: ${roomFailures.map(rf => rf.roomId).join(', ')}`,
    ].join('\n'));

    return { roomFailures, items };
}
