import { Agent, run } from '@openai/agents';
import type {
    StationSkeleton,
    CreativeContent,
    RoomCreative,
    EnemyCreative,
    ItemCreative,
    CrewMember,
} from './types.js';

const CREATIVE_PROMPT = `You are a JSON content generator for a sci-fi survival horror game set on a derelict space station. Output ONLY valid JSON — no markdown, no code fences, no commentary.

Generate atmospheric, horror-themed creative content for the station described below. Style: Alien meets Dead Space. Crew logs should tell a coherent story of the station's downfall matching the story arc.

RULES:
- Every roomId/enemyId/itemId in your output MUST match an ID from the skeleton
- Crew log authors must come from the crew roster you generate
- Room names must be evocative and unique (never generic like "Room 1")
- Enemy names should reflect their tier and nature
- Keep descriptions concise but atmospheric`;

interface CreativeSchema {
    stationName?: string;
    briefing?: string;
    backstory?: string;
    crewRoster?: Array<{ name?: string; role?: string; fate?: string }>;
    rooms?: Array<{
        roomId: string;
        name?: string;
        descriptionSeed?: string;
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
});

function buildSkeletonSummary(skeleton: StationSkeleton): string {
    const roomSummaries = skeleton.rooms.map(r => ({
        id: r.id,
        archetype: r.archetype,
        depth: r.depth,
        hasEnemy: r.enemySlot !== null,
        enemyTier: r.enemySlot?.tier ?? null,
        hasLoot: r.lootSlot !== null,
        lootCategory: r.lootSlot?.category ?? null,
        isObjective: r.isObjectiveRoom,
    }));

    const enemySummaries = skeleton.enemies.map(e => ({
        id: e.id,
        tier: e.tier,
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

function validateCreative(content: CreativeSchema, skeleton: StationSkeleton): CreativeContent {
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
            { name: 'Dr. Tanaka', role: 'Chief Medical Officer', fate: 'Transformed' },
            { name: 'Rodriguez', role: 'Chief Engineer', fate: 'Missing' },
            { name: 'Director Holst', role: 'Station Director', fate: 'Corrupted' },
        );
    }

    const crewNames = new Set(crewRoster.map(c => c.name));

    const rooms: RoomCreative[] = skeleton.rooms.map(skRoom => {
        const creative = (content.rooms ?? []).find(r => r.roomId === skRoom.id);
        const validLogs = (creative?.crewLogs ?? [])
            .filter(log => crewNames.has(log.author) || log.author === 'Unknown')
            .map(log => ({
                type: (log.type ?? 'datapad') as RoomCreative['crewLogs'][number]['type'],
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
                type: 'terminal_entry' as const,
                author: crewRoster[0]?.name ?? 'Unknown',
                content: 'Systems failing. Need to evacuate.',
                condition: 'A flickering terminal display.',
            }],
        };
    });

    const enemies: EnemyCreative[] = skeleton.enemies.map(skEnemy => {
        const creative = (content.enemies ?? []).find(e => e.enemyId === skEnemy.id);
        return {
            enemyId: skEnemy.id,
            name: creative?.name ?? `Entity-${String(skEnemy.tier)}${skEnemy.id.slice(-2)}`,
            appearance: creative?.appearance ?? 'A twisted form emerges from the shadows.',
            personality: creative?.personality ?? skEnemy.personality,
            deathDescription: creative?.deathDescription ?? 'It collapses and goes still.',
            soundSignature: creative?.soundSignature ?? 'A low, rattling breath.',
        };
    });

    const items: ItemCreative[] = skeleton.items.map(skItem => {
        const creative = (content.items ?? []).find(i => i.itemId === skItem.id);
        return {
            itemId: skItem.id,
            name: creative?.name ?? skItem.id.replace(/_/g, ' '),
            description: creative?.description ?? skItem.effect.description,
            useNarration: creative?.useNarration ?? `You use the ${skItem.id.replace(/_/g, ' ')}.`,
        };
    });

    // Filter out rooms/enemies/items with IDs not in skeleton
    const validRooms = rooms.filter(r => roomIds.has(r.roomId));
    const validEnemies = enemies.filter(e => enemyIds.has(e.enemyId));
    const validItems = items.filter(i => itemIds.has(i.itemId));

    return {
        stationName: content.stationName ?? 'Station Omega',
        briefing: content.briefing ?? 'Board the station. Find the black box. Get out alive.',
        backstory: content.backstory ?? 'The station went dark three months ago. No distress signal. No survivors.',
        crewRoster,
        rooms: validRooms,
        enemies: validEnemies,
        items: validItems,
    };
}

/** Room-generation milestone messages shown as individual rooms stream in. */
const ROOM_MILESTONES = [
    'Detailing the environment...',
    'Scanning for biosignatures...',
    'Recovering crew logs...',
    'Analyzing environmental hazards...',
    'Charting the deepest corridors...',
];

/** Build progress phases dynamically, using unique room IDs as milestones. */
function buildProgressPhases(skeleton: StationSkeleton): Array<{ pattern: string; message: string }> {
    const phases: Array<{ pattern: string; message: string }> = [
        { pattern: '"stationName"', message: 'Naming the station...' },
        { pattern: '"briefing"', message: 'Writing mission briefing...' },
        { pattern: '"backstory"', message: 'Uncovering what happened...' },
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
        { pattern: '"enemies"', message: 'Spawning threats...' },
        { pattern: '"items"', message: 'Placing equipment...' },
    );

    return phases;
}

export async function generateCreativeContent(
    skeleton: StationSkeleton,
    onProgress?: (message: string) => void,
    debugLog?: (label: string, content: string) => void,
): Promise<CreativeContent> {
    const summary = buildSkeletonSummary(skeleton);

    const jsonSchema = JSON.stringify({
        stationName: "string",
        briefing: "string (1-2 sentences mission briefing)",
        backstory: "string (2-3 sentences about what happened)",
        crewRoster: [{ name: "string", role: "string", fate: "string" }],
        rooms: [{
            roomId: "string (must match skeleton)",
            name: "string (evocative name)",
            descriptionSeed: "string (2-3 sentences)",
            sensory: {
                sounds: ["string (3 items)"],
                smells: ["string (2 items)"],
                visuals: ["string (3 items)"],
                tactile: "string",
            },
            crewLogs: [{
                type: "datapad|wall_scrawl|audio_recording|terminal_entry",
                author: "string (from crew roster)",
                content: "string",
                condition: "string (physical description of the log medium)",
            }],
        }],
        enemies: [{
            enemyId: "string (must match skeleton)",
            name: "string",
            appearance: "string (1-2 sentences)",
            personality: "string",
            deathDescription: "string",
            soundSignature: "string",
        }],
        items: [{
            itemId: "string (must match skeleton)",
            name: "string",
            description: "string",
            useNarration: "string",
        }],
    }, null, 2);

    const userPrompt = `Generate creative content for this station skeleton:

${summary}

Your output MUST be valid JSON matching this schema:
${jsonSchema}

Generate 3-5 crew roster members. Each room should have 1-2 crew logs. Output ONLY the JSON object.`;

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

        const raw = stream.finalOutput ?? '{}';

        // Extract JSON from potential markdown code fences
        let jsonStr = raw.trim();
        const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(jsonStr);
        if (fenceMatch) {
            jsonStr = fenceMatch[1].trim();
        }

        const parsed = JSON.parse(jsonStr) as CreativeSchema;
        return validateCreative(parsed, skeleton);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        debugLog?.('CREATIVE', `Creative generation failed: ${message}`);
        onProgress?.('Generation failed — using fallback content...');
        return validateCreative({
            stationName: 'Station Omega',
            briefing: 'Board the station. Complete the mission. Escape alive.',
            backstory: 'The station went dark three months ago.',
            crewRoster: [],
            rooms: [],
            enemies: [],
            items: [],
        }, skeleton);
    }
}
