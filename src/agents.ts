import type { ToolSet, LanguageModel } from 'ai';
import type { GameToolSets } from './tools.js';
import type { GeneratedStation, CharacterBuild } from './types.js';
import { buildOrchestratorPrompt } from './prompt.js';
import { gameMasterModel } from './models.js';

interface GameMasterConfig {
    model: LanguageModel;
    systemPrompt: string;
    tools: ToolSet;
}

export function createGameMasterConfig(
    station: GeneratedStation,
    build: CharacterBuild,
    toolSets: GameToolSets,
): GameMasterConfig {
    return {
        model: gameMasterModel,
        systemPrompt: buildOrchestratorPrompt(station, build),
        tools: toolSets.all,
    };
}
