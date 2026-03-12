import type {
    ActionDifficulty,
    ActiveEvent,
    CharacterBuild,
    CharacterClassId,
    FailureMode,
    GameState,
    ItemEffect,
    ItemSkeleton,
    Room,
    RoomArchetype,
    SystemId,
} from './types.js';

// ─── Character Builds ───────────────────────────────────────────────────────

export const CHARACTER_BUILDS: ReadonlyMap<CharacterClassId, CharacterBuild> = new Map<CharacterClassId, CharacterBuild>([
    ['engineer', {
        id: 'engineer',
        name: 'Systems Engineer',
        description: 'A resourceful technician who can bypass failing systems with duct tape, wire, and sheer stubbornness.',
        baseHp: 100,
        proficiencies: ['tech', 'survival'],
        weaknesses: ['medical', 'command'],
        startingItem: 'multitool',
        maxInventory: 6,
    }],
    ['scientist', {
        id: 'scientist',
        name: 'Research Scientist',
        description: 'An analytical mind who synthesizes solutions from first principles. Needs fewer materials to craft.',
        baseHp: 85,
        proficiencies: ['science', 'tech'],
        weaknesses: ['survival', 'command'],
        startingItem: 'diagnostic_scanner',
        maxInventory: 5,
    }],
    ['medic', {
        id: 'medic',
        name: 'Flight Surgeon',
        description: 'A trauma specialist who keeps one body functioning through creative medicine and an alarming willingness to improvise.',
        baseHp: 110,
        proficiencies: ['medical', 'science'],
        weaknesses: ['tech', 'command'],
        startingItem: 'first_aid_kit',
        maxInventory: 5,
    }],
    ['commander', {
        id: 'commander',
        name: 'Operations Lead',
        description: 'A crisis coordinator who sees the whole failure graph. Can assess cascade timers in adjacent rooms and stay decisive under pressure.',
        baseHp: 100,
        proficiencies: ['survival', 'command'],
        weaknesses: ['science', 'tech'],
        startingItem: null,
        maxInventory: 5,
    }],
]);

// ─── Starting Items ─────────────────────────────────────────────────────────

export const STARTING_ITEMS: ReadonlyMap<string, ItemSkeleton> = new Map([
    ['multitool', {
        id: 'multitool',
        category: 'tool',
        effect: { type: 'tool', value: 1, description: 'A versatile tool for bypassing locks, repairing systems, and prying open panels. Reusable.' } satisfies ItemEffect,
        isKeyItem: false,
    }],
    ['diagnostic_scanner', {
        id: 'diagnostic_scanner',
        category: 'tool',
        effect: { type: 'tool', value: 1, description: 'A handheld scanner that reads environmental sensors and diagnoses system failures. Reusable.' } satisfies ItemEffect,
        isKeyItem: false,
    }],
    ['first_aid_kit', {
        id: 'first_aid_kit',
        category: 'medical',
        effect: { type: 'heal', value: 30, description: 'A standard-issue medical kit that restores 30 HP when used.' } satisfies ItemEffect,
        isKeyItem: false,
    }],
]);

// ─── Engineering Items Catalog ──────────────────────────────────────────────

interface EngineeringItemDef {
    id: string;
    category: string;
    effect: ItemEffect;
    isKeyItem: boolean;
}

export const ENGINEERING_ITEMS: ReadonlyMap<string, EngineeringItemDef> = new Map([
    // Materials (consumed on use)
    ['sealant_patch', { id: 'sealant_patch', category: 'material', effect: { type: 'material', value: 1, description: 'Quick-set polymer sealant for hull breaches and pipe leaks.' }, isKeyItem: false }],
    ['insulated_wire', { id: 'insulated_wire', category: 'material', effect: { type: 'material', value: 1, description: 'High-gauge insulated wiring for electrical repairs.' }, isKeyItem: false }],
    ['coolant_canister', { id: 'coolant_canister', category: 'material', effect: { type: 'material', value: 1, description: 'Pressurized coolant for thermal regulation systems.' }, isKeyItem: false }],
    ['structural_epoxy', { id: 'structural_epoxy', category: 'material', effect: { type: 'material', value: 1, description: 'Industrial-strength adhesive rated for vacuum and thermal stress.' }, isKeyItem: false }],
    ['bio_filter', { id: 'bio_filter', category: 'material', effect: { type: 'material', value: 1, description: 'Biological filtration membrane for atmosphere and water systems.' }, isKeyItem: false }],
    ['replacement_valve', { id: 'replacement_valve', category: 'component', effect: { type: 'component', value: 1, description: 'Standard-fit valve assembly for fluid and gas systems.' }, isKeyItem: false }],

    // Tools (reusable, never consumed)
    ['welding_rig', { id: 'welding_rig', category: 'tool', effect: { type: 'tool', value: 1, description: 'Portable arc welder for structural repairs. Reusable.' }, isKeyItem: false }],

    // Chemicals (consumed on use)
    ['lithium_hydroxide', { id: 'lithium_hydroxide', category: 'chemical', effect: { type: 'chemical', value: 1, description: 'CO2 scrubbing agent. Critical for life support repairs.' }, isKeyItem: false }],
    ['neutralizer_agent', { id: 'neutralizer_agent', category: 'chemical', effect: { type: 'chemical', value: 1, description: 'Broad-spectrum chemical neutralizer for contamination cleanup.' }, isKeyItem: false }],
    ['solvent', { id: 'solvent', category: 'chemical', effect: { type: 'chemical', value: 1, description: 'Industrial solvent for dissolving corrosion and clearing blockages.' }, isKeyItem: false }],

    // Medical (consumed on use)
    ['stim_injector', { id: 'stim_injector', category: 'medical', effect: { type: 'heal', value: 20, description: 'Adrenaline stimulant — quick heal.' }, isKeyItem: false }],
    ['anti_rad_dose', { id: 'anti_rad_dose', category: 'medical', effect: { type: 'heal', value: 15, description: 'Potassium iodide treatment for radiation exposure.' }, isKeyItem: false }],
]);

// ─── Crafting Recipes ───────────────────────────────────────────────────────

interface CraftRecipe {
    resultId: string;
    resultName: string;
    ingredients: string[];
    requiredTool: string | null;
    difficulty: ActionDifficulty;
}

export const CRAFT_RECIPES: readonly CraftRecipe[] = [
    { resultId: 'improvised_sealant', resultName: 'Improvised Sealant', ingredients: ['structural_epoxy', 'solvent'], requiredTool: null, difficulty: 'easy' },
    { resultId: 'rewired_relay', resultName: 'Rewired Relay Module', ingredients: ['insulated_wire', 'insulated_wire'], requiredTool: 'multitool', difficulty: 'moderate' },
    { resultId: 'co2_scrubber_cartridge', resultName: 'CO2 Scrubber Cartridge', ingredients: ['lithium_hydroxide', 'bio_filter'], requiredTool: null, difficulty: 'moderate' },
    { resultId: 'radiation_patch', resultName: 'Radiation Shielding Patch', ingredients: ['sealant_patch', 'structural_epoxy'], requiredTool: 'welding_rig', difficulty: 'hard' },
    { resultId: 'coolant_bypass', resultName: 'Coolant Bypass Assembly', ingredients: ['replacement_valve', 'coolant_canister'], requiredTool: 'multitool', difficulty: 'moderate' },
    { resultId: 'contamination_filter', resultName: 'Contamination Filter', ingredients: ['bio_filter', 'neutralizer_agent'], requiredTool: null, difficulty: 'easy' },
] as const;

// ─── System Failure Pools by Room Archetype ─────────────────────────────────

export interface SystemFailureTemplate {
    systemId: SystemId;
    failureModes: FailureMode[];
    requiredMaterials: string[];
    requiredSkill: 'tech' | 'science' | 'medical' | 'survival';
    diagnosisHint: string;
    mitigationPaths: string[];
}

export const SYSTEM_FAILURE_POOLS: ReadonlyMap<RoomArchetype, SystemFailureTemplate[]> = new Map([
    ['quarters', [
        { systemId: 'life_support', failureModes: ['leak', 'blockage'], requiredMaterials: ['bio_filter'], requiredSkill: 'tech', diagnosisHint: 'Elevated CO2 readings; recycler fan noise irregular', mitigationPaths: ['Replace bio_filter in air handler', 'Improvise filter from available textiles'] },
        { systemId: 'fire_suppression', failureModes: ['mechanical', 'software'], requiredMaterials: ['replacement_valve'], requiredSkill: 'tech', diagnosisHint: 'Suppression system armed but valve response delayed', mitigationPaths: ['Replace stuck valve', 'Bypass electronic trigger with manual pull'] },
    ]],
    ['utility', [
        { systemId: 'power_relay', failureModes: ['overload', 'corrosion'], requiredMaterials: ['insulated_wire'], requiredSkill: 'tech', diagnosisHint: 'Bus voltage fluctuating; smell of burnt insulation', mitigationPaths: ['Replace damaged wiring section', 'Reroute through backup bus'] },
        { systemId: 'water_recycler', failureModes: ['contamination', 'blockage'], requiredMaterials: ['bio_filter', 'solvent'], requiredSkill: 'science', diagnosisHint: 'Water output cloudy; bacterial count above safe limits', mitigationPaths: ['Replace filter and flush with solvent', 'UV sterilize and manually filter'] },
        { systemId: 'structural_integrity', failureModes: ['structural', 'corrosion'], requiredMaterials: ['structural_epoxy'], requiredSkill: 'survival', diagnosisHint: 'Hairline fractures visible along stress seam', mitigationPaths: ['Apply structural epoxy to fractures', 'Weld reinforcement plates over weak points'] },
    ]],
    ['science', [
        { systemId: 'atmosphere_processor', failureModes: ['contamination', 'mechanical'], requiredMaterials: ['bio_filter'], requiredSkill: 'science', diagnosisHint: 'Trace gas composition anomalous; processor motor vibration pattern wrong', mitigationPaths: ['Replace contaminated filter element', 'Clean intake manifold and recalibrate'] },
        { systemId: 'radiation_shielding', failureModes: ['structural', 'corrosion'], requiredMaterials: ['sealant_patch', 'structural_epoxy'], requiredSkill: 'science', diagnosisHint: 'Dosimeter climbing; shielding material degraded', mitigationPaths: ['Patch shielding gaps with sealant and epoxy', 'Reroute shielding from decommissioned area'] },
        { systemId: 'coolant_loop', failureModes: ['leak', 'blockage'], requiredMaterials: ['coolant_canister', 'replacement_valve'], requiredSkill: 'tech', diagnosisHint: 'Floor wet with coolant; temperature rising in adjacent systems', mitigationPaths: ['Replace leaking valve and refill coolant', 'Bypass damaged section and reroute flow'] },
    ]],
    ['command', [
        { systemId: 'communications', failureModes: ['software', 'overload'], requiredMaterials: ['insulated_wire'], requiredSkill: 'tech', diagnosisHint: 'Comms array powered but transmitting noise; signal processor overloaded', mitigationPaths: ['Replace burned signal processor wiring', 'Reset firmware and recalibrate antenna'] },
        { systemId: 'power_relay', failureModes: ['overload', 'mechanical'], requiredMaterials: ['insulated_wire'], requiredSkill: 'tech', diagnosisHint: 'Primary relay tripped; backup struggling under load', mitigationPaths: ['Replace relay coil wiring', 'Shed non-critical loads and bypass'] },
    ]],
    ['medical', [
        { systemId: 'life_support', failureModes: ['contamination', 'leak'], requiredMaterials: ['bio_filter', 'sealant_patch'], requiredSkill: 'medical', diagnosisHint: 'Air quality alarms; trace chemicals in atmosphere', mitigationPaths: ['Replace contaminated filter and seal leak', 'Activate emergency air scrubbers and isolate source'] },
        { systemId: 'water_recycler', failureModes: ['contamination', 'mechanical'], requiredMaterials: ['neutralizer_agent', 'bio_filter'], requiredSkill: 'medical', diagnosisHint: 'Medical water supply contaminated; automated testing flagged anomalies', mitigationPaths: ['Neutralize contaminant and replace filter', 'Switch to emergency sealed water reserves'] },
    ]],
    ['cargo', [
        { systemId: 'pressure_seal', failureModes: ['structural', 'leak'], requiredMaterials: ['sealant_patch', 'structural_epoxy'], requiredSkill: 'survival', diagnosisHint: 'Pressure dropping slowly; whistling from cargo bay wall seam', mitigationPaths: ['Seal breach with sealant and reinforce with epoxy', 'Improvise pressure barrier from cargo materials'] },
        { systemId: 'gravity_generator', failureModes: ['mechanical', 'overload'], requiredMaterials: ['replacement_valve'], requiredSkill: 'tech', diagnosisHint: 'Intermittent gravity fluctuations; generator humming at wrong frequency', mitigationPaths: ['Replace worn bearing assembly', 'Reduce to 0.5g and stabilize'] },
    ]],
    ['restricted', [
        { systemId: 'radiation_shielding', failureModes: ['structural', 'corrosion'], requiredMaterials: ['sealant_patch', 'structural_epoxy'], requiredSkill: 'science', diagnosisHint: 'Radiation levels above normal; shielding integrity compromised', mitigationPaths: ['Patch degraded shielding sections', 'Deploy temporary lead barriers'] },
        { systemId: 'fire_suppression', failureModes: ['software', 'mechanical'], requiredMaterials: ['replacement_valve'], requiredSkill: 'tech', diagnosisHint: 'Fire suppression offline; control panel showing fault codes', mitigationPaths: ['Replace faulty actuator valve', 'Bypass electronic controls with manual override'] },
    ]],
    ['reactor', [
        { systemId: 'coolant_loop', failureModes: ['leak', 'overload'], requiredMaterials: ['coolant_canister', 'replacement_valve'], requiredSkill: 'tech', diagnosisHint: 'Coolant pressure dropping; temperature rising above nominal', mitigationPaths: ['Replace valve and refill coolant', 'Open emergency venting and bypass damaged section'] },
        { systemId: 'power_relay', failureModes: ['overload', 'mechanical'], requiredMaterials: ['insulated_wire'], requiredSkill: 'tech', diagnosisHint: 'Main bus arcing; load distribution uneven', mitigationPaths: ['Replace damaged relay wiring', 'Shed reactor load and redistribute'] },
        { systemId: 'radiation_shielding', failureModes: ['structural', 'leak'], requiredMaterials: ['sealant_patch', 'structural_epoxy'], requiredSkill: 'science', diagnosisHint: 'Neutron flux readings elevated; containment showing micro-fractures', mitigationPaths: ['Apply sealant to micro-fractures', 'Reduce reactor output to lower radiation levels'] },
        { systemId: 'thermal_regulator', failureModes: ['mechanical', 'blockage'], requiredMaterials: ['coolant_canister', 'solvent'], requiredSkill: 'tech', diagnosisHint: 'Heat exchanger efficiency dropping; flow rate below spec', mitigationPaths: ['Flush blockage with solvent and refill coolant', 'Switch to backup heat exchanger'] },
    ]],
]);

// ─── Action Duration Tables (time-based system) ────────────────────────────

/** Base duration in minutes for each tool under ideal conditions. */
const BASE_DURATIONS: Readonly<Record<string, number>> = {
    look_around: 2,
    move_to: 3,
    pick_up_item: 1,
    use_item: 2,
    attempt_action: 5,
    diagnose_system: 5,
    stabilize_hazard: 8,
    repair_system: 12,
    improvise_repair: 10,
    craft_item: 8,
    check_environment: 1,
    analyze_item: 2,
    bypass_system: 5,
    field_surgery: 8,
    crisis_assessment: 3,
    complete_objective: 1,
    // Zero-time tools
    record_moral_choice: 0,
    suggest_actions: 0,
    suggest_diagnostics: 0,
} as const;

/** Time multiplier per active event type (environmental conditions). */
const EVENT_TIME_MULTIPLIERS: Readonly<Record<string, number>> = {
    power_failure: 1.5,
    hull_breach: 1.3,
    coolant_leak: 1.4,
    radiation_spike: 1.2,
    atmosphere_alarm: 1.2,
} as const;

/** Time multiplier per action difficulty level. */
const DIFFICULTY_TIME_MULTIPLIERS: Readonly<Record<ActionDifficulty, number>> = {
    trivial: 1.0,
    easy: 1.2,
    moderate: 1.5,
    hard: 2.0,
    extreme: 3.0,
    impossible: 3.0,
} as const;

/**
 * Compute how many minutes an action takes given the tool, player state,
 * active events, current room, and optional difficulty.
 */
export function computeActionMinutes(
    toolName: string,
    state: GameState,
    activeEvents: ActiveEvent[],
    room: Room,
    difficulty?: ActionDifficulty,
): number {
    let minutes = BASE_DURATIONS[toolName] ?? 1;

    // Difficulty scaling (for tools that pass a difficulty)
    if (difficulty) minutes *= DIFFICULTY_TIME_MULTIPLIERS[difficulty];

    // Environmental modifiers from active events
    for (const event of activeEvents) {
        minutes *= EVENT_TIME_MULTIPLIERS[event.type] ?? 1.0;
    }

    // Player condition modifiers
    if (state.suitIntegrity < 50) minutes *= 1.3;
    if (state.hp / state.maxHp < 0.3) minutes *= 1.4;

    // Room hazard modifiers — each active system failure adds friction
    const activeFailures = room.systemFailures.filter(f =>
        f.challengeState !== 'resolved' && f.challengeState !== 'failed'
    );
    minutes *= Math.pow(1.1, activeFailures.length);

    return Math.round(minutes);
}
