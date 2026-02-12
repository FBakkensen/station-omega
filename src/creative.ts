import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import type {
    StationSkeleton,
    CreativeContent,
    RoomCreative,
    EnemyCreative,
    ItemCreative,
    CrewMember,
} from './types.js';

const CREATIVE_PROMPT = `# Identity

You are a creative content generator for a sci-fi engineering survival adventure with dry humor, set on a derelict space station with cascading system failures.

# Style

Grounded sci-fi with personality. The Martian meets Project Hail Mary. The station is falling apart — systems are the antagonist, not creatures. Crew logs should read like frustrated engineering reports, sarcastic maintenance memos, or panicked calibration records. Tell a coherent story of cascading system failures matching the story arc.

# Rules

- Every roomId/enemyId/itemId in your output MUST match an ID from the skeleton provided
- Crew log authors must come from the crew roster you generate
- Room names must be practical engineering labels — the kind of names that would be on actual station bulkhead signs (e.g., "Primary Coolant Junction", "Atmospheric Processing Bay", "Cargo Lock C-7")
- Enemy names should be technical designations for malfunctioning systems — drones, security turrets, AI fragments. Never include tier numbers or difficulty indicators
- Keep descriptions concise — focus on what's broken, what's working, what the sensors read. Engineering details, not atmosphere
- Item names must be immersive and in-universe. Name items as a space station engineer would label equipment
- engineeringNotes: 1-2 sentences of technical detail about the room's systems — what's nominal, what's degraded, what readings are off
- Generate 3-5 crew roster members (engineers, scientists, technicians)
- Each room should have 1-2 crew logs (prefer engineering_report, calibration_record, failure_analysis types)
- Provide 3 sounds, 2 smells, and 3 visuals per room — focus on diagnostic clues (the sound a pump makes when it's cavitating, the smell of coolant, the flicker pattern of failing lights)`;

/** Zod schema for structured output — guarantees valid JSON from gpt-5-mini. */
const CreativeOutputSchema = z.object({
    stationName: z.string(),
    briefing: z.string(),
    backstory: z.string(),
    crewRoster: z.array(z.object({
        name: z.string(),
        role: z.string(),
        fate: z.string(),
    })),
    rooms: z.array(z.object({
        roomId: z.string(),
        name: z.string(),
        descriptionSeed: z.string(),
        engineeringNotes: z.string(),
        sensory: z.object({
            sounds: z.array(z.string()),
            smells: z.array(z.string()),
            visuals: z.array(z.string()),
            tactile: z.string(),
        }),
        crewLogs: z.array(z.object({
            type: z.string(),
            author: z.string(),
            content: z.string(),
            condition: z.string(),
        })),
    })),
    enemies: z.array(z.object({
        enemyId: z.string(),
        name: z.string(),
        appearance: z.string(),
        personality: z.string(),
        deathDescription: z.string(),
        soundSignature: z.string(),
        failureMode: z.string(),
    })),
    items: z.array(z.object({
        itemId: z.string(),
        name: z.string(),
        description: z.string(),
        useNarration: z.string(),
    })),
});

/** Partial shape accepted by validateCreative for fallback paths. */
interface CreativeSchemaPartial {
    stationName?: string;
    briefing?: string;
    backstory?: string;
    crewRoster?: Array<{ name?: string; role?: string; fate?: string }>;
    rooms?: Array<{
        roomId: string;
        name?: string;
        descriptionSeed?: string;
        engineeringNotes?: string;
        sensory?: {
            sounds?: string[];
            smells?: string[];
            visuals?: string[];
            tactile?: string;
        };
        crewLogs?: Array<{
            type?: string;
            author: string;
            content?: string;
            condition?: string;
        }>;
    }>;
    enemies?: Array<{
        enemyId: string;
        name?: string;
        appearance?: string;
        personality?: string;
        deathDescription?: string;
        soundSignature?: string;
        failureMode?: string;
    }>;
    items?: Array<{
        itemId: string;
        name?: string;
        description?: string;
        useNarration?: string;
    }>;
}

// Module-level creative agent (reusable, stateless)
const creativeAgent = new Agent({
    name: 'CreativeGenerator',
    model: 'gpt-5-mini',
    instructions: CREATIVE_PROMPT,
    modelSettings: { store: false, reasoning: { effort: 'low' } },
    outputType: CreativeOutputSchema,
});

function buildSkeletonSummary(skeleton: StationSkeleton): string {
    const roomSummaries = skeleton.rooms.map(r => ({
        id: r.id,
        archetype: r.archetype,
        depth: r.depth,
        hasEnemy: r.enemySlot !== null,
        hasLoot: r.lootSlot !== null,
        lootCategory: r.lootSlot?.category ?? null,
        isObjective: r.isObjectiveRoom,
        systemFailures: r.systemFailures.map(f => ({ system: f.systemId, mode: f.failureMode, severity: f.severity })),
    }));

    const enemySummaries = skeleton.enemies.map(e => ({
        id: e.id,
        behaviorHint: e.behaviorHint,
        personality: e.personality,
    }));

    const itemSummaries = skeleton.items.map(i => ({
        id: i.id,
        category: i.category,
        effectType: i.effect.type,
    }));

    return JSON.stringify({
        storyArc: skeleton.config.storyArc,
        difficulty: skeleton.config.difficulty,
        objectiveTitle: skeleton.objectives.title,
        objectiveSteps: skeleton.objectives.steps.map(s => s.description),
        rooms: roomSummaries,
        enemies: enemySummaries,
        items: itemSummaries,
    }, null, 2);
}

/** Strip leading "Tier N" prefixes that the creative agent may bake into enemy names. */
function sanitizeEnemyName(name: string): string {
    return name.replace(/^Tier\s*\d+\s*[-\u2013\u2014*:]\s*/i, '').trim() || name;
}

function validateCreative(content: CreativeSchemaPartial, skeleton: StationSkeleton): CreativeContent {
    const roomIds = new Set(skeleton.rooms.map(r => r.id));
    const enemyIds = new Set(skeleton.enemies.map(e => e.id));
    const itemIds = new Set(skeleton.items.map(i => i.id));

    const crewRoster: CrewMember[] = (content.crewRoster ?? []).map(c => ({
        name: c.name ?? 'Unknown',
        role: c.role ?? 'Crew',
        fate: c.fate ?? 'Unknown',
    }));

    if (crewRoster.length === 0) {
        crewRoster.push(
            { name: 'Chen Wei', role: 'Chief Engineer', fate: 'Missing — last seen heading to reactor level' },
            { name: 'Dr. Okafor', role: 'Environmental Systems Lead', fate: 'Evacuated to section 7' },
            { name: 'Rodriguez', role: 'Station Commander', fate: 'Unknown — comms cut during cascade' },
        );
    }

    const crewNames = new Set(crewRoster.map(c => c.name));

    const VALID_LOG_TYPES = new Set(['datapad', 'wall_scrawl', 'audio_recording', 'terminal_entry', 'engineering_report', 'calibration_record', 'failure_analysis']);

    const rooms: RoomCreative[] = skeleton.rooms.map(skRoom => {
        const creative = (content.rooms ?? []).find(r => r.roomId === skRoom.id);
        const validLogs = (creative?.crewLogs ?? [])
            .filter(log => crewNames.has(log.author) || log.author === 'Unknown')
            .map(log => ({
                type: (VALID_LOG_TYPES.has(log.type ?? '') ? log.type : 'terminal_entry') as RoomCreative['crewLogs'][number]['type'],
                author: log.author,
                content: log.content ?? '',
                condition: log.condition ?? 'Found nearby.',
            }));

        return {
            roomId: skRoom.id,
            name: creative?.name ?? `${skRoom.archetype.charAt(0).toUpperCase()}${skRoom.archetype.slice(1)} ${skRoom.id.split('_')[1] ?? ''}`.trim(),
            descriptionSeed: creative?.descriptionSeed ?? `A ${skRoom.archetype} area of the station.`,
            sensory: {
                sounds: creative?.sensory?.sounds ?? ['The hum of failing systems'],
                smells: creative?.sensory?.smells ?? ['Stale recycled air'],
                visuals: creative?.sensory?.visuals ?? ['Emergency lights flicker dimly'],
                tactile: creative?.sensory?.tactile ?? 'The air feels stale and cold.',
            },
            crewLogs: validLogs.length > 0 ? validLogs : [{
                type: 'engineering_report' as const,
                author: crewRoster[0]?.name ?? 'Unknown',
                content: 'Systems degrading faster than projected. Running out of workarounds.',
                condition: 'A flickering terminal display.',
            }],
            engineeringNotes: creative?.engineeringNotes ?? '',
        };
    });

    const enemies: EnemyCreative[] = skeleton.enemies.map(skEnemy => {
        const creative = (content.enemies ?? []).find(e => e.enemyId === skEnemy.id);
        return {
            enemyId: skEnemy.id,
            name: creative?.name ? sanitizeEnemyName(creative.name) : 'Unknown System',
            appearance: creative?.appearance ?? 'A piece of station hardware that\'s decided to stop cooperating.',
            personality: creative?.personality ?? skEnemy.personality,
            deathDescription: creative?.deathDescription ?? 'It powers down with a descending whine. Finally.',
            soundSignature: creative?.soundSignature ?? 'Servos and static.',
            failureMode: creative?.failureMode ?? 'corrupted firmware',
        };
    });

    const items: ItemCreative[] = skeleton.items.map(skItem => {
        const creative = (content.items ?? []).find(i => i.itemId === skItem.id);
        return {
            itemId: skItem.id,
            name: creative?.name ?? skItem.effect.description,
            description: creative?.description ?? skItem.effect.description,
            useNarration: creative?.useNarration ?? `You use the ${skItem.effect.description}.`,
        };
    });

    // Filter out rooms/enemies/items with IDs not in skeleton
    const validRooms = rooms.filter(r => roomIds.has(r.roomId));
    const validEnemies = enemies.filter(e => enemyIds.has(e.enemyId));
    const validItems = items.filter(i => itemIds.has(i.itemId));

    return {
        stationName: content.stationName ?? 'Station Omega',
        briefing: content.briefing ?? 'Board the station. Fix what you can. Get to the escape pod.',
        backstory: content.backstory ?? 'The station went dark three days ago. The last transmission was a cascade failure alarm followed by a lot of creative profanity.',
        crewRoster,
        rooms: validRooms,
        enemies: validEnemies,
        items: validItems,
    };
}

/** Room-generation milestone messages shown as individual rooms stream in. */
const ROOM_MILESTONES = [
    'Mapping system failures...',
    'Scanning environmental readings...',
    'Recovering engineering logs...',
    'Analyzing cascade patterns...',
    'Charting the deepest sections...',
];

/** Build progress phases dynamically, using unique room IDs as milestones. */
function buildProgressPhases(skeleton: StationSkeleton): Array<{ pattern: string; message: string }> {
    const phases: Array<{ pattern: string; message: string }> = [
        { pattern: '"stationName"', message: 'Naming the station...' },
        { pattern: '"briefing"', message: 'Writing mission briefing...' },
        { pattern: '"backstory"', message: 'Uncovering what went wrong...' },
        { pattern: '"crewRoster"', message: 'Assembling the crew manifest...' },
        { pattern: '"rooms"', message: 'Mapping station corridors...' },
    ];

    // Room generation is the longest phase. Spread milestones across individual
    // rooms using their unique IDs for fine-grained progress updates.
    const rooms = skeleton.rooms;
    const count = Math.min(ROOM_MILESTONES.length, Math.max(0, rooms.length - 1));
    for (let i = 0; i < count; i++) {
        const idx = Math.round(((i + 1) * rooms.length) / (count + 1));
        phases.push({ pattern: `"${rooms[idx].id}"`, message: ROOM_MILESTONES[i] });
    }

    phases.push(
        { pattern: '"enemies"', message: 'Identifying malfunctioning systems...' },
        { pattern: '"items"', message: 'Placing equipment and materials...' },
    );

    return phases;
}

export async function generateCreativeContent(
    skeleton: StationSkeleton,
    onProgress?: (message: string) => void,
    debugLog?: (label: string, content: string) => void,
): Promise<CreativeContent> {
    const summary = buildSkeletonSummary(skeleton);

    const userPrompt = `Generate creative content for this station skeleton:

<station_skeleton>
${summary}
</station_skeleton>

Briefing: 1-2 sentences. Backstory: 2-3 sentences. Room descriptions: 2-3 sentences each focusing on engineering state. engineeringNotes: 1-2 sentences of technical readings. Enemy appearances: 1-2 sentences (malfunctioning hardware). Crew log type must be one of: datapad, wall_scrawl, audio_recording, terminal_entry, engineering_report, calibration_record, failure_analysis.`;

    try {
        const stream = await run(creativeAgent, userPrompt, {
            maxTurns: 1,
            stream: true,
        });

        const phases = buildProgressPhases(skeleton);
        let accumulated = '';
        let phaseIndex = 0;
        for await (const event of stream) {
            if (onProgress && event.type === 'raw_model_stream_event') {
                const data = event.data as { type: string; delta?: string };
                if (data.type === 'output_text_delta' && data.delta) {
                    accumulated += data.delta;
                    // Check if we've reached the next JSON section
                    while (phaseIndex < phases.length
                        && accumulated.includes(phases[phaseIndex].pattern)) {
                        onProgress(phases[phaseIndex].message);
                        phaseIndex++;
                    }
                }
            }
        }

        // Structured output: finalOutput is already parsed and validated by Zod
        const parsed = stream.finalOutput;
        if (!parsed) {
            throw new Error('Creative agent produced no output');
        }
        return validateCreative(parsed, skeleton);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        debugLog?.('CREATIVE', `Creative generation failed: ${message}`);
        onProgress?.('Generation failed — using fallback content...');
        return validateCreative({
            stationName: 'Station Omega',
            briefing: 'Board the station. Fix the cascade. Escape alive.',
            backstory: 'The station went dark three days ago. Systems are failing in sequence.',
            crewRoster: [],
            rooms: [],
            enemies: [],
            items: [],
        }, skeleton);
    }
}
