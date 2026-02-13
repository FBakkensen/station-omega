import { Agent, handoff } from '@openai/agents';
import type { OutputGuardrail } from '@openai/agents';
import { GameResponseSchema } from './schema.js';
import type { GameContext, GameToolSets } from './tools.js';
import type { GeneratedStation, CharacterBuild } from './types.js';
import {
    buildOrchestratorPrompt,
    buildEngineeringPrompt,
    buildDiagnosticsPrompt,
    buildExplorationPrompt,
} from './prompt.js';

export interface GameAgents {
    gameMaster: Agent<GameContext, typeof GameResponseSchema>;
    engineeringAgent: Agent<GameContext, typeof GameResponseSchema>;
    diagnosticsAgent: Agent<GameContext, typeof GameResponseSchema>;
    explorationAgent: Agent<GameContext, typeof GameResponseSchema>;
}

export function createAgents(
    station: GeneratedStation,
    build: CharacterBuild,
    toolSets: GameToolSets,
    guardrail: OutputGuardrail<typeof GameResponseSchema>,
): GameAgents {
    const engineeringAgent = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'EngineeringVoice',
        model: 'gpt-5.2',
        instructions: buildEngineeringPrompt(station, build),
        tools: toolSets.engineering,
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        modelSettings: {
            store: true,
            promptCacheRetention: '24h',
            reasoning: { effort: 'none' },
            text: { verbosity: 'low' },
        },
    });

    const diagnosticsAgent = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'DiagnosticsVoice',
        model: 'gpt-5-mini',
        instructions: buildDiagnosticsPrompt(station, build),
        tools: toolSets.diagnostics,
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        modelSettings: {
            store: true,
            reasoning: { effort: 'low' },
        },
    });

    // Handoffs — defined before agents that reference them
    const engineeringHandoff = handoff(engineeringAgent, {
        toolNameOverride: 'transfer_to_engineering',
        toolDescriptionOverride: 'Hand off to engineering voice when the player repairs, modifies, or improvises with systems.',
        isEnabled: ({ runContext }) => {
            const { state, station: s } = runContext.context;
            const room = s.rooms.get(state.currentRoom);
            if (!room) return false;
            // Enable if room has unresolved system failures
            return room.systemFailures.some(f => f.challengeState !== 'resolved' && f.challengeState !== 'failed');
        },
    });

    const explorationAgent = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'ExplorationVoice',
        model: 'gpt-5-mini',
        instructions: buildExplorationPrompt(station, build),
        tools: toolSets.exploration,
        handoffs: [engineeringHandoff],
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        modelSettings: {
            store: true,
            reasoning: { effort: 'low' },
        },
    });

    const diagnosticsHandoff = handoff(diagnosticsAgent, {
        toolNameOverride: 'transfer_to_diagnostics',
        toolDescriptionOverride: 'Hand off to diagnostics voice when the player examines terminals, reads sensors, analyzes problems, or interacts with NPCs.',
        isEnabled: ({ runContext }) => {
            const { state, station: s } = runContext.context;
            const room = s.rooms.get(state.currentRoom);
            if (!room) return false;
            // Enable if room has system failures to investigate, or NPCs present
            const hasFailures = room.systemFailures.some(f => f.challengeState !== 'resolved');
            const hasNpcs = [...s.npcs.values()].some(n => n.roomId === state.currentRoom);
            return hasFailures || hasNpcs || room.crewLogs.length > 0;
        },
    });

    const explorationHandoff = handoff(explorationAgent, {
        toolNameOverride: 'transfer_to_exploration',
        toolDescriptionOverride: 'Hand off to exploration voice when the player enters a room, explores, picks up items, or attempts creative actions.',
        // Always enabled — exploration is always available
    });

    const gameMaster = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'GameMaster',
        model: 'gpt-5.2',
        instructions: buildOrchestratorPrompt(station, build),
        tools: toolSets.all,
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        handoffs: [engineeringHandoff, diagnosticsHandoff, explorationHandoff],
        modelSettings: {
            store: true,
            promptCacheRetention: '24h',
            reasoning: { effort: 'none' },
            text: { verbosity: 'low' },
        },
    });

    return { gameMaster, engineeringAgent, diagnosticsAgent, explorationAgent };
}
