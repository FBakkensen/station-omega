/**
 * Disaster family mapping — explicit mapping from scenario themes to
 * mechanical family IDs. Used at generation and runtime to align hazards,
 * objectives, and narration with the station's core disaster identity.
 */

import type { SystemId, EventType } from '../types.js';

// ─── Family IDs ─────────────────────────────────────────────────────────────

export type DisasterFamilyId =
    | 'infrastructure_collapse'
    | 'environmental_hazard'
    | 'power_crisis'
    | 'multi_cascade_fallback';

// ─── Family Metadata ────────────────────────────────────────────────────────

export interface DisasterFamilyMeta {
    id: DisasterFamilyId;
    displayName: string;
    description: string;
    /** Systems most associated with this family, for failure placement bias. */
    primarySystems: SystemId[];
    /** Room archetypes where this family's hazards are most likely. */
    favoredRoomArchetypes: string[];
    /** Event types this family favors for random hazard spawning. */
    hazardAffinity: EventType[];
    /** Event types suppressed by this family unless state-driven. */
    hazardSuppressed: EventType[];
    /** Cascade bias: how aggressively failures propagate within this family. */
    cascadeBias: number;
}

export const DISASTER_FAMILIES: ReadonlyMap<DisasterFamilyId, DisasterFamilyMeta> = new Map([
    ['infrastructure_collapse', {
        id: 'infrastructure_collapse',
        displayName: 'Infrastructure Collapse',
        description: 'Structural and pressure failures are tearing the station apart.',
        primarySystems: ['pressure_seal', 'structural_integrity', 'gravity_generator'],
        favoredRoomArchetypes: ['cargo', 'utility', 'entry', 'escape'],
        hazardAffinity: ['hull_breach', 'structural_alert'],
        hazardSuppressed: ['radiation_spike'],
        cascadeBias: 1.3,
    }],
    ['environmental_hazard', {
        id: 'environmental_hazard',
        displayName: 'Environmental Hazard',
        description: 'Atmosphere, temperature, or radiation conditions are lethal and spreading.',
        primarySystems: ['life_support', 'atmosphere_processor', 'thermal_regulator', 'radiation_shielding'],
        favoredRoomArchetypes: ['science', 'reactor', 'medical'],
        hazardAffinity: ['atmosphere_alarm', 'radiation_spike', 'coolant_leak', 'fire_outbreak'],
        hazardSuppressed: ['structural_alert'],
        cascadeBias: 1.1,
    }],
    ['power_crisis', {
        id: 'power_crisis',
        displayName: 'Power Crisis',
        description: 'The power grid is failing and systems are going dark one by one.',
        primarySystems: ['power_relay', 'coolant_loop', 'fire_suppression'],
        favoredRoomArchetypes: ['reactor', 'utility', 'command'],
        hazardAffinity: ['power_failure', 'fire_outbreak', 'coolant_leak'],
        hazardSuppressed: ['hull_breach'],
        cascadeBias: 1.4,
    }],
    ['multi_cascade_fallback', {
        id: 'multi_cascade_fallback',
        displayName: 'Multi-System Crisis',
        description: 'Multiple unrelated systems are failing simultaneously.',
        primarySystems: ['life_support', 'power_relay', 'pressure_seal', 'communications'],
        favoredRoomArchetypes: ['utility', 'command', 'restricted'],
        hazardAffinity: ['hull_breach', 'atmosphere_alarm', 'power_failure', 'coolant_leak'],
        hazardSuppressed: [],
        cascadeBias: 1.2,
    }],
]);

// ─── Theme-to-Family Mapping ────────────────────────────────────────────────

const THEME_FAMILY_MAP: ReadonlyMap<string, DisasterFamilyId> = new Map([
    // Infrastructure collapse (native + remapped)
    ['Cascading hull breach', 'infrastructure_collapse'],
    ['Structural delamination', 'infrastructure_collapse'],
    ['Pressure bulkhead failure', 'infrastructure_collapse'],
    ['Deck collapse chain', 'infrastructure_collapse'],
    ['Welding seam fatigue', 'infrastructure_collapse'],
    ['Docking pylon shear', 'infrastructure_collapse'],
    ['Ventilation network rupture', 'infrastructure_collapse'],
    ['Gravity plating cascade', 'infrastructure_collapse'],
    // Remapped external/comms → infrastructure
    ['Gravitational anomaly', 'infrastructure_collapse'],
    ['Debris field collision', 'infrastructure_collapse'],
    ['Relay satellite destruction', 'infrastructure_collapse'],
    ['Sensor array blindness', 'infrastructure_collapse'],
    ['Beacon malfunction loop', 'infrastructure_collapse'],

    // Environmental hazard (native + remapped)
    ['Radiation storm exposure', 'environmental_hazard'],
    ['Atmosphere contamination', 'environmental_hazard'],
    ['Cryogenic coolant leak', 'environmental_hazard'],
    ['Thermal runaway', 'environmental_hazard'],
    ['Corrosive gas infiltration', 'environmental_hazard'],
    ['Particulate fog event', 'environmental_hazard'],
    ['Electromagnetic interference storm', 'environmental_hazard'],
    ['Oxygen depletion crisis', 'environmental_hazard'],
    // Remapped external → environmental
    ['Solar flare bombardment', 'environmental_hazard'],
    ['Tidal lock drift', 'environmental_hazard'],
    ['Plasma wake turbulence', 'environmental_hazard'],
    ['Subspace interference field', 'environmental_hazard'],

    // Power crisis
    ['Reactor scram lockout', 'power_crisis'],
    ['Power grid cascade failure', 'power_crisis'],
    ['Fuel cell depletion', 'power_crisis'],
    ['Solar array misalignment', 'power_crisis'],
    ['EMP surge aftermath', 'power_crisis'],
    ['Superconductor quench', 'power_crisis'],
    ['Generator phase desync', 'power_crisis'],
    ['Battery thermal runaway', 'power_crisis'],

    // Multi-cascade fallback (biological, complex external, info-crises)
    ['Biolab containment breach', 'multi_cascade_fallback'],
    ['Fungal infestation', 'multi_cascade_fallback'],
    ['Pathogen outbreak', 'multi_cascade_fallback'],
    ['Algae bloom in water supply', 'multi_cascade_fallback'],
    ['Insect swarm emergence', 'multi_cascade_fallback'],
    ['Prion contamination alert', 'multi_cascade_fallback'],
    ['Symbiotic organism rejection', 'multi_cascade_fallback'],
    ['Spore dispersal event', 'multi_cascade_fallback'],
    ['Rogue asteroid approach', 'multi_cascade_fallback'],
    ['Magnetic field reversal', 'multi_cascade_fallback'],
    ['Cosmic ray burst', 'multi_cascade_fallback'],
    ['Total signal blackout', 'multi_cascade_fallback'],
    ['Navigation computer corruption', 'multi_cascade_fallback'],
    ['Ghost signal jamming', 'multi_cascade_fallback'],
    ['Time dilation anomaly', 'multi_cascade_fallback'],
]);

/** Resolve a scenario theme to its disaster family. Falls back to multi_cascade_fallback for unknown themes. */
export function getDisasterFamily(theme: string): DisasterFamilyId {
    return THEME_FAMILY_MAP.get(theme) ?? 'multi_cascade_fallback';
}

/** Get full family metadata for a scenario theme. */
export function getDisasterFamilyMeta(theme: string): DisasterFamilyMeta {
    const familyId = getDisasterFamily(theme);
    const meta = DISASTER_FAMILIES.get(familyId);
    if (!meta) throw new Error(`Unknown disaster family: ${familyId}`);
    return meta;
}
