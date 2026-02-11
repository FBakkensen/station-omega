import { Agent, handoff } from '@openai/agents';
import type { OutputGuardrail } from '@openai/agents';
import { GameResponseSchema } from './schema.js';
import type { GameContext, GameToolSets } from './tools.js';
import type { GeneratedStation, CharacterBuild } from './types.js';
import {
    buildOrchestratorPrompt,
    buildCombatPrompt,
    buildDialoguePrompt,
    buildExplorationPrompt,
} from './prompt.js';

export interface GameAgents {
    gameMaster: Agent<GameContext, typeof GameResponseSchema>;
    combatAgent: Agent<GameContext, typeof GameResponseSchema>;
    dialogueAgent: Agent<GameContext, typeof GameResponseSchema>;
    explorationAgent: Agent<GameContext, typeof GameResponseSchema>;
}

export function createAgents(
    station: GeneratedStation,
    build: CharacterBuild,
    toolSets: GameToolSets,
    guardrail: OutputGuardrail<typeof GameResponseSchema>,
): GameAgents {
    const combatAgent = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'CombatNarrator',
        model: 'gpt-5.2',
        instructions: buildCombatPrompt(station, build),
        tools: toolSets.combat,
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        modelSettings: {
            store: true,
            promptCacheRetention: '24h',
            reasoning: { effort: 'none' },
            text: { verbosity: 'low' },
        },
    });

    const dialogueAgent = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'DialogueNarrator',
        model: 'gpt-5-mini',
        instructions: buildDialoguePrompt(station, build),
        tools: toolSets.dialogue,
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        modelSettings: {
            store: true,
            reasoning: { effort: 'low' },
        },
    });

    // Handoffs — defined before agents that reference them
    const combatHandoff = handoff(combatAgent, {
        toolNameOverride: 'transfer_to_combat',
        toolDescriptionOverride: 'Hand off to combat narrator when the player engages an enemy or is in active combat.',
        isEnabled: ({ runContext }) => {
            const { state, station: s } = runContext.context;
            const room = s.rooms.get(state.currentRoom);
            if (!room?.threat) return false;
            const npc = s.npcs.get(room.threat);
            return npc !== undefined && npc.disposition !== 'dead';
        },
    });

    const explorationAgent = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'ExplorationNarrator',
        model: 'gpt-5-mini',
        instructions: buildExplorationPrompt(station, build),
        tools: toolSets.exploration,
        handoffs: [combatHandoff],
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        modelSettings: {
            store: true,
            reasoning: { effort: 'low' },
        },
    });

    const dialogueHandoff = handoff(dialogueAgent, {
        toolNameOverride: 'transfer_to_dialogue',
        toolDescriptionOverride: 'Hand off to dialogue narrator when the player wants to interact with an NPC non-violently.',
        isEnabled: ({ runContext }) => {
            const { state, station: s } = runContext.context;
            return [...s.npcs.values()].some(n => n.roomId === state.currentRoom && n.disposition !== 'dead');
        },
    });

    const explorationHandoff = handoff(explorationAgent, {
        toolNameOverride: 'transfer_to_exploration',
        toolDescriptionOverride: 'Hand off to exploration narrator when the player enters a room, explores, picks up items, or attempts creative actions.',
        // Always enabled — exploration is always available
    });

    const gameMaster = new Agent<GameContext, typeof GameResponseSchema>({
        name: 'GameMaster',
        model: 'gpt-5.2',
        instructions: buildOrchestratorPrompt(station, build),
        tools: toolSets.all,
        outputType: GameResponseSchema,
        outputGuardrails: [guardrail],
        handoffs: [combatHandoff, dialogueHandoff, explorationHandoff],
        modelSettings: {
            store: true,
            promptCacheRetention: '24h',
            reasoning: { effort: 'none' },
            text: { verbosity: 'low' },
        },
    });

    return { gameMaster, combatAgent, dialogueAgent, explorationAgent };
}
