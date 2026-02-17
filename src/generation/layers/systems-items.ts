/**
 * Layer 2: System Failures & Items
 *
 * Given validated topology from Layer 1, the AI places system
 * failures in rooms and distributes engineering materials/tools.
 */

import { z } from 'zod';
import type { LayerConfig, LayerContext } from '../layer-runner.js';
import {
    checkRoomExists,
    checkMaterialReachability,
    validationSuccess,
    validationFailure,
} from '../validate.js';
import type { ValidationResult } from '../validate.js';
import type { ValidatedTopology } from './topology.js';
import { ENGINEERING_ITEMS } from '../../data.js';
import type { SystemId, FailureMode, ActionDomain } from '../../types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const SystemIdEnum = z.enum([
    'life_support', 'pressure_seal', 'power_relay', 'coolant_loop',
    'atmosphere_processor', 'gravity_generator', 'radiation_shielding',
    'communications', 'fire_suppression', 'water_recycler',
    'thermal_regulator', 'structural_integrity',
]);

const FailureModeEnum = z.enum([
    'leak', 'overload', 'contamination', 'structural',
    'blockage', 'corrosion', 'software', 'mechanical',
]);

const ActionDomainEnum = z.enum(['tech', 'medical', 'social', 'survival', 'science']);

export const SystemsItemsSchema = z.object({
    roomFailures: z.array(z.object({
        roomId: z.string(),
        failures: z.array(z.object({
            systemId: SystemIdEnum,
            failureMode: FailureModeEnum,
            severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            requiredMaterials: z.array(z.string()),
            requiredSkill: ActionDomainEnum,
            diagnosisHint: z.string(),
            mitigationPaths: z.array(z.string()),
            cascadeTarget: z.string().nullable(),
            minutesUntilCascade: z.number(),
        })),
    })),
    items: z.array(z.object({
        id: z.string(),
        roomId: z.string(),
        baseItemKey: z.string(),
        isKeyItem: z.boolean(),
    })),
});

export type SystemsItemsOutput = z.infer<typeof SystemsItemsSchema>;

// ─── Validated Type ──────────────────────────────────────────────────────────

export interface ValidatedSystemsItems {
    roomFailures: Array<{
        roomId: string;
        failures: Array<{
            systemId: SystemId;
            failureMode: FailureMode;
            severity: 1 | 2 | 3;
            requiredMaterials: string[];
            requiredSkill: ActionDomain;
            diagnosisHint: string;
            mitigationPaths: string[];
            cascadeTarget: string | null;
            minutesUntilCascade: number;
        }>;
    }>;
    items: Array<{
        id: string;
        roomId: string;
        baseItemKey: string;
        isKeyItem: boolean;
    }>;
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildSystemsItemsPrompt(context: LayerContext, errors?: string[]): { system: string; user: string } {
    const topology = context['topology'] as ValidatedTopology;
    const validMaterials = [...ENGINEERING_ITEMS.keys()];

    const system = `You are a systems engineer designing failures and equipment placement for a derelict space station.

# Available Systems
life_support, pressure_seal, power_relay, coolant_loop, atmosphere_processor, gravity_generator, radiation_shielding, communications, fire_suppression, water_recycler, thermal_regulator, structural_integrity

# Failure Modes
leak, overload, contamination, structural, blockage, corrosion, software, mechanical

# Required Skills
tech, medical, social, survival, science

# Available Engineering Materials (use these exact baseItemKey values)
${validMaterials.join(', ')}

# Rules
- Place system failures in ~60-80% of non-entry/non-escape rooms
- Each room with failures should have 1-2 failures
- Severity: 1 (minor/degraded), 2 (failing, has cascade timer), 3 (critical, fast cascade)
- Severity 1: minutesUntilCascade should be 0 (no cascade)
- Severity 2: minutesUntilCascade should be 60-120
- Severity 3: minutesUntilCascade should be 30-60
- cascadeTarget: must be a room adjacent to the failure room, or null. Only set when minutesUntilCascade > 0
- requiredMaterials: 1-3 materials from the available list. These are what the player needs to repair the failure
- diagnosisHint: a brief sensor reading or observable clue for the player
- mitigationPaths: 1-2 possible approaches to fix or work around the failure

# Item Placement
- Place items to ensure ALL required materials for ALL failures are available somewhere in the station
- Each item needs: id (unique, like "sealant_patch_0"), roomId, baseItemKey (from the available list), isKeyItem
- isKeyItem: ONLY true for keycards. All other items (materials, tools, medical, chemicals) must be isKeyItem false — they are consumed when used for repairs. Keycards persist because you physically keep the card after swiping it
- For locked doors: place keycard items (id like "keycard_0", baseItemKey "keycard", isKeyItem true) in rooms accessible BEFORE the locked door
- Also scatter 3-5 extra materials (medical supplies, spare parts) for player resourcefulness
- Do NOT place items in the entry or escape rooms (entry room gets a starting item separately)

# Match failures to room archetypes thematically
- reactor rooms: coolant_loop, power_relay, radiation_shielding, thermal_regulator
- medical rooms: life_support, water_recycler
- science rooms: atmosphere_processor, radiation_shielding, coolant_loop
- utility rooms: power_relay, water_recycler, structural_integrity
- command rooms: communications, power_relay
- cargo rooms: pressure_seal, gravity_generator
- quarters rooms: life_support, fire_suppression
- restricted rooms: radiation_shielding, fire_suppression`;

    const roomsSummary = topology.rooms.map(r => {
        const conns = r.connections.join(', ');
        const lock = r.lockedBy ? ` [locked by ${r.lockedBy}]` : '';
        return `  ${r.id} (${r.archetype}) → connections: [${conns}]${lock}`;
    }).join('\n');

    let user = `Design system failures and item placement for this station:

Topology: ${topology.topology}
Scenario: ${topology.scenario.theme} — ${topology.scenario.centralTension}
Entry: ${topology.entryRoomId}
Escape: ${topology.escapeRoomId}

Rooms:
${roomsSummary}

Place thematically appropriate failures and ensure all required materials are reachable.`;

    if (errors && errors.length > 0) {
        user += `\n\nYour previous output had the following errors. Fix ALL of them:\n\n${errors.map((e, i) => `${String(i + 1)}. ${e}`).join('\n')}\n\nGenerate a corrected version addressing all errors above.`;
    }

    return { system, user };
}

// ─── Validator ───────────────────────────────────────────────────────────────

function validateSystemsItems(output: SystemsItemsOutput, context: LayerContext): ValidationResult<ValidatedSystemsItems> {
    const topology = context['topology'] as ValidatedTopology;
    const errors: string[] = [];
    const roomIdSet = new Set(topology.rooms.map(r => r.id));
    const validMaterialKeys = new Set(ENGINEERING_ITEMS.keys());
    // Also allow keycard as a valid item key
    validMaterialKeys.add('keycard');
    const repairs: string[] = [];

    // 1. Room references in failures
    for (const rf of output.roomFailures) {
        const roomErr = checkRoomExists(rf.roomId, topology.rooms);
        if (roomErr) {
            errors.push(`roomId '${rf.roomId}' in roomFailures does not exist in the topology`);
            continue;
        }

        // Entry/escape should not have failures
        if (rf.roomId === topology.entryRoomId) {
            errors.push(`Entry room ${topology.entryRoomId} should not have system failures`);
        }
        if (rf.roomId === topology.escapeRoomId) {
            errors.push(`Escape room ${topology.escapeRoomId} should not have system failures`);
        }

        for (const f of rf.failures) {
            // Auto-fix: severity 1 should have no cascade
            if (f.severity === 1 && (f.minutesUntilCascade !== 0 || f.cascadeTarget !== null)) {
                repairs.push(`${rf.roomId}/${f.systemId}: cleared cascade on severity-1 failure`);
                f.minutesUntilCascade = 0;
                f.cascadeTarget = null;
            }

            // Auto-fix: cascade target must exist and be adjacent
            if (f.cascadeTarget) {
                if (!roomIdSet.has(f.cascadeTarget)) {
                    repairs.push(`${rf.roomId}/${f.systemId}: nullified cascadeTarget '${f.cascadeTarget}' (room does not exist)`);
                    f.cascadeTarget = null;
                } else {
                    const room = topology.rooms.find(r => r.id === rf.roomId);
                    if (room && !room.connections.includes(f.cascadeTarget)) {
                        repairs.push(`${rf.roomId}/${f.systemId}: nullified cascadeTarget '${f.cascadeTarget}' (not adjacent)`);
                        f.cascadeTarget = null;
                    }
                }
            }

            // Auto-fix: cascadeTarget with no timer is pointless
            if (f.minutesUntilCascade === 0 && f.cascadeTarget !== null) {
                repairs.push(`${rf.roomId}/${f.systemId}: nullified cascadeTarget (no cascade timer)`);
                f.cascadeTarget = null;
            }

            // Required materials must be valid keys
            for (const mat of f.requiredMaterials) {
                if (!validMaterialKeys.has(mat)) {
                    errors.push(`Required material '${mat}' in ${rf.roomId} failure is not a valid material. Valid keys: [${[...ENGINEERING_ITEMS.keys()].join(', ')}]`);
                }
            }
        }
    }

    // 2. Item validation
    const itemIds = output.items.map(i => i.id);
    const itemIdSet = new Set(itemIds);
    if (itemIdSet.size !== itemIds.length) {
        const dupes = itemIds.filter((id, i) => itemIds.indexOf(id) !== i);
        errors.push(`Duplicate item IDs: ${[...new Set(dupes)].join(', ')}`);
    }

    for (const item of output.items) {
        if (!roomIdSet.has(item.roomId)) {
            errors.push(`Item '${item.id}' references room '${item.roomId}' which does not exist`);
        }
        if (item.roomId === topology.entryRoomId) {
            errors.push(`Item '${item.id}' is placed in entry room — do not place items in the entry room`);
        }
        if (item.roomId === topology.escapeRoomId) {
            errors.push(`Item '${item.id}' is placed in escape room — do not place items in the escape room`);
        }
        if (item.baseItemKey !== 'keycard' && !ENGINEERING_ITEMS.has(item.baseItemKey)) {
            errors.push(`Item '${item.id}' references unknown baseItemKey '${item.baseItemKey}'. Valid keys: [${[...ENGINEERING_ITEMS.keys()].join(', ')}]`);
        }
    }

    // 3. Auto-fix isKeyItem to match baseItemKey (only keycards are key items)
    for (const item of output.items) {
        const shouldBeKeyItem = item.baseItemKey === 'keycard';
        if (item.isKeyItem !== shouldBeKeyItem) {
            repairs.push(`Item '${item.id}': corrected isKeyItem ${String(item.isKeyItem)} → ${String(shouldBeKeyItem)}`);
            item.isKeyItem = shouldBeKeyItem;
        }
    }

    // 4. Material solvability — every failure's required materials must be placed somewhere reachable
    for (const rf of output.roomFailures) {
        if (!roomIdSet.has(rf.roomId)) continue;
        for (const f of rf.failures) {
            const matErr = checkMaterialReachability(
                rf.roomId,
                f.requiredMaterials,
                output.items,
                topology.rooms,
                topology.entryRoomId,
            );
            if (matErr) {
                errors.push(matErr);
            }
        }
    }

    // 5. Locked door keys — if topology has locked doors, ensure keycards are placed
    const lockedRooms = topology.rooms.filter(r => r.lockedBy);
    for (const room of lockedRooms) {
        if (!room.lockedBy) continue;
        const keyItem = output.items.find(i => i.id === room.lockedBy || i.baseItemKey === 'keycard' && i.id === room.lockedBy);
        if (!keyItem) {
            errors.push(`Room ${room.id} is locked by '${room.lockedBy}' but no item with that ID exists. Place a keycard item with id '${room.lockedBy}' in a room accessible before ${room.id}`);
        }
    }

    // 6. Minimum item count
    if (output.items.length === 0) {
        errors.push('No items placed in the station — players need materials to repair systems');
    }

    if (errors.length > 0) {
        return validationFailure(errors);
    }

    return validationSuccess<ValidatedSystemsItems>({
        roomFailures: output.roomFailures.map(rf => ({
            roomId: rf.roomId,
            failures: rf.failures.map(f => ({
                systemId: f.systemId as SystemId,
                failureMode: f.failureMode as FailureMode,
                severity: f.severity,
                requiredMaterials: [...f.requiredMaterials],
                requiredSkill: f.requiredSkill as ActionDomain,
                diagnosisHint: f.diagnosisHint,
                mitigationPaths: [...f.mitigationPaths],
                cascadeTarget: f.cascadeTarget,
                minutesUntilCascade: f.minutesUntilCascade,
            })),
        })),
        items: output.items.map(i => ({
            id: i.id,
            roomId: i.roomId,
            baseItemKey: i.baseItemKey,
            isKeyItem: i.isKeyItem,
        })),
    }, repairs);
}

// ─── Layer Config ────────────────────────────────────────────────────────────

export const systemsItemsLayer: LayerConfig<SystemsItemsOutput, ValidatedSystemsItems> = {
    name: 'Systems & Items',
    schema: SystemsItemsSchema,
    buildPrompt: buildSystemsItemsPrompt,
    validate: validateSystemsItems,
    maxRetries: 3,
    summarize: (v) => {
        const bySeverity = { 1: 0, 2: 0, 3: 0 };
        for (const rf of v.roomFailures) {
            for (const f of rf.failures) bySeverity[f.severity]++;
        }
        // Items per room distribution
        const roomItemCounts = new Map<string, number>();
        for (const item of v.items) {
            roomItemCounts.set(item.roomId, (roomItemCounts.get(item.roomId) ?? 0) + 1);
        }
        const dist = [...roomItemCounts.values()].sort((a, b) => a - b);
        const distStr = dist.length > 0
            ? `min=${String(dist[0])}, max=${String(dist[dist.length - 1])}, median=${String(dist[Math.floor(dist.length / 2)])}`
            : 'none';
        return [
            `Failures: ${String(bySeverity[1])} sev-1, ${String(bySeverity[2])} sev-2, ${String(bySeverity[3])} sev-3`,
            `Items: ${String(v.items.length)} total across ${String(roomItemCounts.size)} rooms`,
            `Items-per-room: ${distStr}`,
        ].join('\n');
    },
};
