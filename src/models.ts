import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
    apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
    headers: {
        'HTTP-Referer': 'https://github.com/station-omega',
        'X-Title': 'Station Omega',
    },
});

/** Provider routing: direct to Anthropic, no fallbacks. */
export const anthropicDirect = {
    openrouter: {
        provider: {
            order: ['anthropic'],
            allow_fallbacks: false,
        },
    },
};

/** Model used for the main game master (tool calling + narrative). */
export const gameMasterModel = openrouter('google/gemini-3-flash-preview');

/** Model used for creative content generation (structured output only). */
export const creativeModel = openrouter('anthropic/claude-opus-4.6');
