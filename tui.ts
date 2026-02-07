import {
    createCliRenderer,
    Box,
    Text,
    InputRenderableEvents,
    SelectRenderableEvents,
    TextRenderable,
    MarkdownRenderable,
    BoxRenderable,
    ScrollBoxRenderable,
    InputRenderable,
    SelectRenderable,
    SyntaxStyle,
    RGBA,
    t,
    bold,
    fg,
    bg,
    DistortionEffect,
} from '@opentui/core';
import type { CliRenderer, KeyEvent } from '@opentui/core';
import type {
    CharacterBuild,
    CharacterClassId,
    GameStatus,
    RunHistoryEntry,
    RunMetrics,
    RunScore,
    ScoreGrade,
    SlashCommandDef,
} from './src/types.js';
import { CHARACTER_BUILDS } from './src/character.js';

// ─── Color Palette ───────────────────────────────────────────────────────────

const COLORS = {
    bg: '#0a0e14',
    panelBg: '#111820',
    border: '#1e3a5f',
    title: '#00e5ff',
    text: '#c0c8d4',
    textDim: '#5a6a7a',
    inputBg: '#0d1117',
    inputFocusBg: '#151d28',
    inputText: '#e0e8f0',
    cursor: '#00e5ff',
    hpGood: '#00ff88',
    hpMid: '#ffcc00',
    hpLow: '#ff4444',
    separator: '#1e3a5f',
    narrative: '#d0d8e0',
    cardBg: '#243348',
    cmdCardBg: '#1e2a3a',
    gradeS: '#ffcc00',
    gradeA: '#00ff88',
    gradeB: '#00e5ff',
    gradeC: '#c0c8d4',
    gradeD: '#ff8844',
    gradeF: '#ff4444',
};

// ─── Markdown Theme ─────────────────────────────────────────────────────────

const mdTheme = SyntaxStyle.fromStyles({
    'markup.heading':     { fg: RGBA.fromHex('#00e5ff'), bold: true },
    'markup.bold':        { fg: RGBA.fromHex('#e0e8f0'), bold: true },
    'markup.italic':      { fg: RGBA.fromHex('#8abfff'), italic: true },
    'markup.quote':       { fg: RGBA.fromHex('#7a8a9a'), italic: true },
    'markup.code':        { fg: RGBA.fromHex('#ffcc00') },
    'markup.list.marker': { fg: RGBA.fromHex('#00e5ff') },
});

// ─── ASCII Art ──────────────────────────────────────────────────────────────

const TITLE_ART = [
    ' \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2557',
    ' \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551',
    ' \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551',
    ' \u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551',
    ' \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551  \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551',
    ' \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D   \u255A\u2550\u255D   \u255A\u2550\u255D  \u255A\u2550\u255D   \u255A\u2550\u255D   \u255A\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D',
    '            \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557',
    '           \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557',
    '           \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551  \u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551',
    '           \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551',
    '           \u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551  \u2588\u2588\u2551',
    '            \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D     \u255A\u2550\u255D\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u255D',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function gradeColor(grade: ScoreGrade): string {
    switch (grade) {
        case 'S': return COLORS.gradeS;
        case 'A': return COLORS.gradeA;
        case 'B': return COLORS.gradeB;
        case 'C': return COLORS.gradeC;
        case 'D': return COLORS.gradeD;
        case 'F': return COLORS.gradeF;
    }
}

function scoreBar(value: number, width: number): string {
    const filled = Math.round((Math.min(100, Math.max(0, value)) / 100) * width);
    return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min)}m ${String(sec)}s`;
}

function classIcon(cls: CharacterClassId): string {
    switch (cls) {
        case 'soldier': return '[S]';
        case 'engineer': return '[E]';
        case 'medic': return '[M]';
        case 'hacker': return '[H]';
    }
}

// ─── GameUI ──────────────────────────────────────────────────────────────────

export class GameUI {
    private renderer!: CliRenderer;
    private narrativeScroll!: ScrollBoxRenderable;
    private npcText!: TextRenderable;
    private statusText!: TextRenderable;
    private inputField!: InputRenderable;
    private currentDelta = '';
    private currentDeltaMd: MarkdownRenderable | null = null;
    private inputCallback: ((input: string) => void) | null = null;
    private inputEnabled = true;
    private distortion = new DistortionEffect({ glitchChancePerSecond: 0.3, maxGlitchLines: 2 });
    private distortionFn = (buffer: Parameters<typeof this.distortion.apply>[0], deltaTime: number) => {
        this.distortion.apply(buffer, deltaTime);
    };

    // Slash command state
    private slashCommands: SlashCommandDef[] = [];
    private popupState: 'idle' | 'command' | 'target' = 'idle';
    private selectedCommand: SlashCommandDef | null = null;
    private popupBox!: BoxRenderable;
    private popupSelect!: SelectRenderable;
    private popupHint!: TextRenderable;

    // Inline attack choices state
    private inlineChoices: SelectRenderable | null = null;
    private inlineChoicesCard: BoxRenderable | null = null;
    private inlineChoicesActive = false;

    // Layout root ref for screen swaps
    private layoutRoot!: BoxRenderable;

    async init(): Promise<void> {
        this.renderer = await createCliRenderer({
            exitOnCtrlC: true,
            useAlternateScreen: true,
            targetFps: 30,
        });

        // Create mutable components with the Renderable API
        this.narrativeScroll = new ScrollBoxRenderable(this.renderer, {
            id: 'narrative-scroll',
            flexGrow: 1,
            width: '100%',
            stickyScroll: true,
            stickyStart: 'bottom',
            scrollY: true,
            contentOptions: {
                flexDirection: 'column',
                paddingTop: 1,
                paddingBottom: 1,
                gap: 1,
            },
        });

        this.npcText = new TextRenderable(this.renderer, {
            id: 'npc-text',
            content: t`${fg(COLORS.textDim)('Contacts: none')}`,
        });

        this.statusText = new TextRenderable(this.renderer, {
            id: 'status-text',
            content: t`${fg(COLORS.textDim)('Initializing...')}`,
        });

        this.inputField = new InputRenderable(this.renderer, {
            id: 'input-field',
            width: '100%' as unknown as number,
            placeholder: 'Enter your command...',
            backgroundColor: COLORS.inputBg,
            focusedBackgroundColor: COLORS.inputFocusBg,
            textColor: COLORS.inputText,
            cursorColor: COLORS.cursor,
        });

        // Wire up input Enter event
        this.inputField.on(InputRenderableEvents.ENTER, (value: string) => {
            const trimmed = value.trim();
            if (!trimmed || !this.inputEnabled) return;

            // If popup is active, let selectPopupItem handle it
            if (this.popupState !== 'idle') return;

            this.inputField.value = '';

            // Dismiss inline choices when player types their own text
            if (this.inlineChoicesActive) this.dismissInlineChoices();

            // Try to translate typed slash commands (e.g. "/move forward")
            const prompt = this.translateSlashInput(trimmed);
            if (this.inputCallback) {
                this.inputCallback(prompt);
            }
        });

        // Create popup components
        this.popupHint = new TextRenderable(this.renderer, {
            id: 'popup-hint',
            content: t`${fg(COLORS.title)('/ Commands')}`,
        });

        this.popupSelect = new SelectRenderable(this.renderer, {
            id: 'popup-select',
            options: [],
            flexGrow: 1,
            selectedBackgroundColor: '#1e3a5f',
            selectedTextColor: '#00e5ff',
            textColor: COLORS.text,
            backgroundColor: '#0d1117',
            wrapSelection: true,
            showDescription: true,
        });

        this.popupSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
            this.selectPopupItem();
        });

        this.popupBox = new BoxRenderable(this.renderer, {
            id: 'popup-box',
            position: 'absolute',
            bottom: 1,
            left: 1,
            width: '50%',
            height: 14,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            backgroundColor: '#0d1117',
            zIndex: 10,
            visible: false,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
        });
        this.popupBox.add(this.popupHint);
        this.popupBox.add(this.popupSelect);

        // Intercept key presses on the input field for popup + inline choices navigation
        const origHandleKey = this.inputField.handleKeyPress.bind(this.inputField);
        this.inputField.handleKeyPress = (key: KeyEvent): boolean => {
            // Inline attack choices navigation
            if (this.inlineChoicesActive && this.inlineChoices) {
                if (key.name === 'up') { this.inlineChoices.moveUp(); return true; }
                if (key.name === 'down') { this.inlineChoices.moveDown(); return true; }
                if (key.name === 'escape') { this.dismissInlineChoices(); return true; }
                if (key.name === 'return' && !this.inputField.value.trim()) {
                    this.selectInlineChoice();
                    return true;
                }
            }

            // Slash command popup navigation
            if (this.popupState !== 'idle') {
                if (key.name === 'up') { this.popupSelect.moveUp(); return true; }
                if (key.name === 'down') { this.popupSelect.moveDown(); return true; }
                if (key.name === 'escape') { this.dismissPopup(); return true; }
                if (key.name === 'return' || key.name === 'tab') {
                    this.selectPopupItem();
                    return true;
                }
            }

            const result = origHandleKey(key);
            this.updatePopupFromInput();
            return result;
        };

        // Build gameplay layout
        this.layoutRoot = new BoxRenderable(this.renderer, {
            id: 'layout-root',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
        });

        this.buildGameplayLayout();
        this.renderer.root.add(this.layoutRoot);
        this.renderer.root.add(this.popupBox);
        this.inputField.focus();
    }

    private buildGameplayLayout(): void {
        // Main narrative panel
        const narrativePanel = Box(
            {
                flexGrow: 1,
                flexDirection: 'column',
                borderStyle: 'rounded',
                borderColor: COLORS.border,
                title: ' STATION OMEGA ',
                titleAlignment: 'center',
                backgroundColor: COLORS.panelBg,
            },
            this.narrativeScroll,
        );

        // NPC contacts bar
        const npcBar = Box(
            {
                height: 1,
                width: '100%',
                flexDirection: 'row',
                backgroundColor: COLORS.panelBg,
                paddingLeft: 1,
                paddingRight: 1,
            },
            this.npcText,
        );

        // Status bar
        const statusBar = Box(
            {
                height: 1,
                width: '100%',
                flexDirection: 'row',
                backgroundColor: COLORS.border,
                paddingLeft: 1,
                paddingRight: 1,
            },
            this.statusText,
        );

        // Input area
        const inputBar = Box(
            {
                height: 1,
                width: '100%',
                flexDirection: 'row',
                paddingLeft: 1,
            },
            Text({ content: t`${fg(COLORS.title)('>')} ` }),
            this.inputField,
        );

        this.layoutRoot.add(narrativePanel);
        this.layoutRoot.add(npcBar);
        this.layoutRoot.add(statusBar);
        this.layoutRoot.add(inputBar);
    }

    private clearLayout(): void {
        for (const child of this.layoutRoot.getChildren()) {
            this.layoutRoot.remove(child.id);
        }
    }

    // ─── Title Screen ───────────────────────────────────────────────────────

    showTitleScreen(): Promise<'new_run' | 'history' | 'quit'> {
        this.clearLayout();

        const artLines = TITLE_ART.map((line, i) =>
            new TextRenderable(this.renderer, {
                id: `title-art-${String(i)}`,
                content: t`${fg(COLORS.title)(line)}`,
            })
        );

        const subtitle = new TextRenderable(this.renderer, {
            id: 'title-subtitle',
            content: t`${fg(COLORS.textDim)('A sci-fi survival text adventure powered by AI')}`,
        });

        const menu = new SelectRenderable(this.renderer, {
            id: 'title-menu',
            options: [
                { name: 'New Run', description: 'Begin a new expedition into Station Omega', value: 'new_run' },
                { name: 'Run History', description: 'View past expedition logs', value: 'history' },
                { name: 'Quit', description: 'Exit the game', value: 'quit' },
            ],
            selectedBackgroundColor: '#1e3a5f',
            selectedTextColor: '#00e5ff',
            textColor: COLORS.text,
            backgroundColor: COLORS.bg,
            wrapSelection: true,
            showDescription: true,
        });

        const artBox = new BoxRenderable(this.renderer, {
            id: 'title-art-box',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 3,
            paddingBottom: 1,
            width: '100%',
        });
        for (const line of artLines) artBox.add(line);

        const menuBox = new BoxRenderable(this.renderer, {
            id: 'title-menu-box',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 2,
            width: '50%',
            marginLeft: 15,
        });
        menuBox.add(subtitle);
        menuBox.add(new TextRenderable(this.renderer, { id: 'title-spacer', content: ' ' }));
        menuBox.add(menu);

        const container = new BoxRenderable(this.renderer, {
            id: 'title-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
        });
        container.add(artBox);
        container.add(menuBox);
        this.layoutRoot.add(container);

        menu.focus();

        return new Promise((resolve) => {
            menu.on(SelectRenderableEvents.ITEM_SELECTED, () => {
                const selected = menu.getSelectedOption();
                if (!selected) return;
                resolve(selected.value as 'new_run' | 'history' | 'quit');
            });
        });
    }

    // ─── Character Select Screen ────────────────────────────────────────────

    showCharacterSelect(builds: ReadonlyMap<CharacterClassId, CharacterBuild> = CHARACTER_BUILDS): Promise<CharacterClassId> {
        this.clearLayout();

        const header = new TextRenderable(this.renderer, {
            id: 'charsel-header',
            content: t`${bold(fg(COLORS.title)('SELECT YOUR OPERATIVE'))}`,
        });

        const buildArray = [...builds.values()];
        const menu = new SelectRenderable(this.renderer, {
            id: 'charsel-menu',
            options: buildArray.map(b => ({
                name: `${classIcon(b.id)} ${b.name}`,
                description: b.description,
                value: b.id,
            })),
            height: buildArray.length * 2,
            selectedBackgroundColor: '#1e3a5f',
            selectedTextColor: '#00e5ff',
            textColor: COLORS.text,
            backgroundColor: COLORS.bg,
            wrapSelection: true,
            showDescription: true,
        });

        const previewText = new TextRenderable(this.renderer, {
            id: 'charsel-preview',
            content: t`${fg(COLORS.textDim)('Select a class to see stats')}`,
        });

        const updatePreview = () => {
            const selected = menu.getSelectedOption();
            if (!selected) return;
            const build = builds.get(selected.value as CharacterClassId);
            if (!build) return;
            const dmgRange = `${String(build.baseDamage[0])}-${String(build.baseDamage[1])}`;
            const profs = build.proficiencies.join(', ');
            const weaks = build.weaknesses.join(', ');
            const startItem = build.startingItem ?? 'none';
            previewText.content = t`${fg(COLORS.text)(`HP: ${String(build.baseHp)}  DMG: ${dmgRange}  INV: ${String(build.maxInventory)} slots`)}\n${fg(COLORS.hpGood)(`+ ${profs}`)}  ${fg(COLORS.hpLow)(`- ${weaks}`)}\n${fg(COLORS.textDim)(`Starting item: ${startItem}`)}`;
        };

        // Update preview on selection change via polling approach
        let lastSelectedIdx = -1;
        const pollInterval = setInterval(() => {
            const opt = menu.getSelectedOption();
            if (!opt) return;
            const idx = buildArray.findIndex(b => b.id === opt.value);
            if (idx !== lastSelectedIdx) {
                lastSelectedIdx = idx;
                updatePreview();
            }
        }, 100);

        updatePreview();

        const container = new BoxRenderable(this.renderer, {
            id: 'charsel-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            paddingTop: 2,
            paddingLeft: 3,
            paddingRight: 3,
        });
        container.add(header);
        container.add(new TextRenderable(this.renderer, { id: 'charsel-spacer1', content: ' ' }));
        container.add(menu);
        container.add(new TextRenderable(this.renderer, { id: 'charsel-spacer2', content: ' ' }));

        const previewBox = new BoxRenderable(this.renderer, {
            id: 'charsel-preview-box',
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            backgroundColor: COLORS.panelBg,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 1,
            width: '100%',
        });
        previewBox.add(previewText);
        container.add(previewBox);

        this.layoutRoot.add(container);
        menu.focus();

        return new Promise((resolve) => {
            menu.on(SelectRenderableEvents.ITEM_SELECTED, () => {
                clearInterval(pollInterval);
                const selected = menu.getSelectedOption();
                if (!selected) return;
                resolve(selected.value as CharacterClassId);
            });
        });
    }

    // ─── Generation Loading Screen ──────────────────────────────────────────

    private loadingText: TextRenderable | null = null;

    showLoadingScreen(message: string): void {
        this.clearLayout();

        const header = new TextRenderable(this.renderer, {
            id: 'loading-header',
            content: t`${bold(fg(COLORS.title)('STATION OMEGA'))}`,
        });

        this.loadingText = new TextRenderable(this.renderer, {
            id: 'loading-text',
            content: t`${fg(COLORS.text)(message)}`,
        });

        const container = new BoxRenderable(this.renderer, {
            id: 'loading-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
        });
        container.add(header);
        container.add(this.loadingText);

        this.layoutRoot.add(container);
    }

    updateLoadingMessage(message: string): void {
        if (this.loadingText) {
            this.loadingText.content = t`${fg(COLORS.text)(message)}`;
        }
    }

    showGenerating(stationName?: string): void {
        const msg = stationName
            ? `Generating ${stationName}...`
            : 'Generating station...';
        this.showLoadingScreen(msg);
    }

    // ─── Transition to Gameplay ─────────────────────────────────────────────

    showGameplayScreen(): void {
        this.clearLayout();
        this.buildGameplayLayout();
        this.inputField.focus();
    }

    // ─── Run Summary Screen ─────────────────────────────────────────────────

    showRunSummary(score: RunScore, metrics: RunMetrics): Promise<void> {
        this.clearLayout();

        const duration = (metrics.endTime ?? Date.now()) - metrics.startTime;
        const gc = gradeColor(score.grade);
        const barWidth = 30;

        const header = new TextRenderable(this.renderer, {
            id: 'summary-header',
            content: t`${bold(fg(COLORS.title)('MISSION REPORT'))}`,
        });

        const gradeDisplay = new TextRenderable(this.renderer, {
            id: 'summary-grade',
            content: t`${bold(fg(gc)(`Grade: ${score.grade}`))}  ${fg(COLORS.text)(`Total: ${String(score.total)}/500`)}`,
        });

        const outcome = metrics.won
            ? t`${fg(COLORS.hpGood)('MISSION COMPLETE')}`
            : t`${fg(COLORS.hpLow)('KIA')}`;
        const outcomeText = new TextRenderable(this.renderer, {
            id: 'summary-outcome',
            content: outcome,
        });

        const bars = [
            { label: 'Speed         ', value: score.speed },
            { label: 'Combat        ', value: score.combatEfficiency },
            { label: 'Exploration   ', value: score.exploration },
            { label: 'Resourceful   ', value: score.resourcefulness },
            { label: 'Completion    ', value: score.completion },
        ];

        const barTexts = bars.map((b, i) => {
            const barColor = b.value >= 75 ? COLORS.hpGood : b.value >= 40 ? COLORS.hpMid : COLORS.hpLow;
            return new TextRenderable(this.renderer, {
                id: `summary-bar-${String(i)}`,
                content: t`${fg(COLORS.textDim)(b.label)} ${fg(barColor)(scoreBar(b.value, barWidth))} ${fg(COLORS.text)(String(Math.round(b.value)))}`,
            });
        });

        const statsText = new TextRenderable(this.renderer, {
            id: 'summary-stats',
            content: t`${fg(COLORS.textDim)('Turns:')} ${fg(COLORS.text)(String(metrics.turnCount))}  ${fg(COLORS.textDim)('Time:')} ${fg(COLORS.text)(formatDuration(duration))}  ${fg(COLORS.textDim)('Kills:')} ${fg(COLORS.text)(String(metrics.enemiesDefeated.length))}  ${fg(COLORS.textDim)('Rooms:')} ${fg(COLORS.text)(String(metrics.roomsVisited.size))}`,
        });

        const hint = new TextRenderable(this.renderer, {
            id: 'summary-hint',
            content: t`${fg(COLORS.textDim)('Press Enter to continue...')}`,
        });

        const container = new BoxRenderable(this.renderer, {
            id: 'summary-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            paddingTop: 2,
            paddingLeft: 3,
            paddingRight: 3,
            gap: 1,
        });

        container.add(header);
        container.add(outcomeText);
        container.add(gradeDisplay);
        container.add(new TextRenderable(this.renderer, { id: 'summary-spacer1', content: ' ' }));
        for (const bt of barTexts) container.add(bt);
        container.add(new TextRenderable(this.renderer, { id: 'summary-spacer2', content: ' ' }));
        container.add(statsText);
        container.add(new TextRenderable(this.renderer, { id: 'summary-spacer3', content: ' ' }));
        container.add(hint);

        this.layoutRoot.add(container);

        return new Promise((resolve) => {
            const tempInput = new InputRenderable(this.renderer, {
                id: 'summary-input',
                width: 0 as unknown as number,
                backgroundColor: COLORS.bg,
                textColor: COLORS.bg,
                cursorColor: COLORS.bg,
            });
            container.add(tempInput);
            tempInput.focus();
            tempInput.on(InputRenderableEvents.ENTER, () => {
                resolve();
            });
        });
    }

    // ─── Run History Screen ─────────────────────────────────────────────────

    showRunHistory(history: RunHistoryEntry[]): Promise<void> {
        this.clearLayout();

        const header = new TextRenderable(this.renderer, {
            id: 'history-header',
            content: t`${bold(fg(COLORS.title)('EXPEDITION LOG'))}`,
        });

        const container = new BoxRenderable(this.renderer, {
            id: 'history-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            paddingTop: 2,
            paddingLeft: 2,
            paddingRight: 2,
        });
        container.add(header);
        container.add(new TextRenderable(this.renderer, { id: 'history-spacer', content: ' ' }));

        if (history.length === 0) {
            container.add(new TextRenderable(this.renderer, {
                id: 'history-empty',
                content: t`${fg(COLORS.textDim)('No expedition records found.')}`,
            }));
        } else {
            // Table header
            const tableHeader = new TextRenderable(this.renderer, {
                id: 'history-table-header',
                content: t`${fg(COLORS.title)('# ')} ${fg(COLORS.title)('Class')} ${fg(COLORS.title)('Arc              ')} ${fg(COLORS.title)('Grade')} ${fg(COLORS.title)('Score')} ${fg(COLORS.title)('Turns')} ${fg(COLORS.title)('Time    ')} ${fg(COLORS.title)('Result')}`,
            });
            container.add(tableHeader);

            const separator = new TextRenderable(this.renderer, {
                id: 'history-table-sep',
                content: t`${fg(COLORS.border)('\u2500'.repeat(70))}`,
            });
            container.add(separator);

            const scroll = new ScrollBoxRenderable(this.renderer, {
                id: 'history-scroll',
                flexGrow: 1,
                width: '100%',
                stickyScroll: false,
                scrollY: true,
                contentOptions: { flexDirection: 'column' },
            });

            const reversed = [...history].reverse();
            for (let i = 0; i < reversed.length; i++) {
                const entry = reversed[i];
                const num = String(history.length - i).padStart(2, ' ');
                const cls = classIcon(entry.characterClass);
                const arc = entry.storyArc.replace(/_/g, ' ').padEnd(17, ' ').slice(0, 17);
                const gc = gradeColor(entry.score.grade);
                const scr = String(entry.score.total).padStart(3, ' ');
                const turns = String(entry.turnCount).padStart(4, ' ');
                const dur = formatDuration(entry.duration).padEnd(8, ' ');
                const result = entry.won ? fg(COLORS.hpGood)('WIN ') : fg(COLORS.hpLow)('DEAD');

                scroll.add(new TextRenderable(this.renderer, {
                    id: `history-row-${String(i)}`,
                    content: t`${fg(COLORS.textDim)(num)} ${fg(COLORS.text)(cls)}  ${fg(COLORS.text)(arc)} ${fg(gc)(entry.score.grade)}     ${fg(COLORS.text)(scr)}   ${fg(COLORS.text)(turns)}  ${fg(COLORS.textDim)(dur)} ${result}`,
                }));
            }

            container.add(scroll);
        }

        container.add(new TextRenderable(this.renderer, { id: 'history-spacer2', content: ' ' }));
        const hint = new TextRenderable(this.renderer, {
            id: 'history-hint',
            content: t`${fg(COLORS.textDim)('Press Enter to return...')}`,
        });
        container.add(hint);

        this.layoutRoot.add(container);

        return new Promise((resolve) => {
            const tempInput = new InputRenderable(this.renderer, {
                id: 'history-input',
                width: 0 as unknown as number,
                backgroundColor: COLORS.bg,
                textColor: COLORS.bg,
                cursorColor: COLORS.bg,
            });
            container.add(tempInput);
            tempInput.focus();
            tempInput.on(InputRenderableEvents.ENTER, () => {
                resolve();
            });
        });
    }

    // ─── Clear Screen ────────────────────────────────────────────────────────

    clearScreen(): void {
        for (const child of this.narrativeScroll.getChildren()) {
            this.narrativeScroll.remove(child.id);
        }
    }

    // ─── Narrative / Cards ──────────────────────────────────────────────────

    private addCard(child: MarkdownRenderable | TextRenderable, bgColor: string): void {
        const card = new BoxRenderable(this.renderer, {
            id: `card-${String(Date.now())}-${String(Math.random()).slice(2, 6)}`,
            backgroundColor: bgColor,
            marginLeft: 1,
            marginRight: 1,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 1,
        });
        card.add(child);
        this.narrativeScroll.add(card);
    }

    /**
     * The MarkdownRenderable filters out blank-line "space" tokens, collapsing
     * paragraph gaps. Insert an invisible Braille Pattern Blank (U+2800) on each
     * blank line so the parser treats it as a content paragraph, preserving the
     * visual spacing the AI intended.
     */
    private spaceParagraphs(md: string): string {
        return md.replace(/\n\n/g, '\n\n\u2800\n\n');
    }

    appendNarrative(text: string): void {
        const md = new MarkdownRenderable(this.renderer, {
            id: `narrative-${String(Date.now())}`,
            content: this.spaceParagraphs(text),
            syntaxStyle: mdTheme,
            streaming: false,
        });
        this.addCard(md, COLORS.cardBg);
    }

    appendNarrativeDelta(delta: string): void {
        this.currentDelta += delta;
        const spaced = this.spaceParagraphs(this.currentDelta);
        if (!this.currentDeltaMd) {
            this.currentDeltaMd = new MarkdownRenderable(this.renderer, {
                id: `delta-${String(Date.now())}`,
                content: spaced,
                syntaxStyle: mdTheme,
                streaming: true,
            });
            this.addCard(this.currentDeltaMd, COLORS.cardBg);
        } else {
            this.currentDeltaMd.content = spaced;
        }
    }

    finalizeDelta(): void {
        if (this.currentDeltaMd) {
            this.currentDeltaMd.streaming = false;
            this.currentDeltaMd.content = this.spaceParagraphs(this.currentDelta);
        }
        this.currentDelta = '';
        this.currentDeltaMd = null;
    }

    appendPlayerCommand(command: string): void {
        const cmdNode = new TextRenderable(this.renderer, {
            id: `cmd-${String(Date.now())}`,
            content: t`${fg('#00e5ff')('>')} ${fg('#5a8abf')(command)}`,
        });
        this.addCard(cmdNode, COLORS.cmdCardBg);
    }

    // ─── Combat Glitch ──────────────────────────────────────────────────────

    enableCombatGlitch(): void {
        this.renderer.addPostProcessFn(this.distortionFn);
    }

    disableCombatGlitch(): void {
        this.renderer.removePostProcessFn(this.distortionFn);
    }

    // ─── Status Bar ─────────────────────────────────────────────────────────

    updateStatus(status: GameStatus): void {
        const hpPct = status.hp / status.maxHp;
        const hpColor = hpPct >= 0.6 ? COLORS.hpGood : hpPct >= 0.25 ? COLORS.hpMid : COLORS.hpLow;
        const hpLabel = hpPct >= 0.8 ? 'Healthy'
            : hpPct >= 0.5 ? 'Wounded'
            : hpPct >= 0.25 ? 'Critical'
            : 'Dying';

        const inv = status.inventory.length > 0 ? status.inventory.join(', ') : 'empty';
        const classLabel = classIcon(status.characterClass);

        this.statusText.content = t`${fg(hpColor)(`HP ${String(status.hp)}/${String(status.maxHp)} ${hpLabel}`)}  ${fg(COLORS.textDim)('|')}  ${fg(COLORS.text)(`${classLabel} ${status.roomName}`)} ${fg(COLORS.textDim)(`(${String(status.roomIndex + 1)}/${String(status.totalRooms)})`)}  ${fg(COLORS.textDim)('|')}  ${fg(COLORS.textDim)(`T${String(status.turnCount)}`)}  ${fg(COLORS.textDim)('|')}  ${fg(COLORS.text)(`Inv: ${inv}`)}`;

        // Update NPC contacts bar — name with HP background, icon-only disposition
        if (status.npcs.length === 0) {
            this.npcText.content = t`${fg(COLORS.textDim)('Contacts: none')}`;
        } else {
            const npc = status.npcs[0];
            const icon = npc.disposition === 'hostile' ? '!'
                : npc.disposition === 'friendly' ? '*'
                : '?';
            const npcHpColor = npc.hpPct >= 0.6 ? '#1a5c2a' : npc.hpPct >= 0.25 ? '#5c4a0a' : '#5c1a1a';
            const emptyColor = '#1a1a2a';
            const padded = ` ${npc.name} `;
            const split = Math.round(npc.hpPct * padded.length);
            const filledPart = padded.slice(0, split);
            const emptyPart = padded.slice(split);

            this.npcText.content = t`${fg(COLORS.textDim)(icon)} ${bg(npcHpColor)(fg('#ffffff')(filledPart))}${bg(emptyColor)(fg(COLORS.textDim)(emptyPart))}`;
        }
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    onInput(callback: (input: string) => void): void {
        this.inputCallback = callback;
    }

    disableInput(): void {
        this.inputEnabled = false;
    }

    enableInput(): void {
        this.inputEnabled = true;
    }

    // ─── Game Over ──────────────────────────────────────────────────────────

    showGameOver(won: boolean): void {
        this.finalizeDelta();

        const message = won
            ? t`${bold(fg('#00ff88')('MISSION COMPLETE'))}${fg(COLORS.textDim)(' -- Thanks for playing Station Omega!')}`
            : t`${bold(fg('#ff4444')('GAME OVER'))}${fg(COLORS.textDim)(' -- You died on Station Omega. Better luck next time.')}`;

        this.narrativeScroll.add(new TextRenderable(this.renderer, {
            id: `gameover-spacer`,
            content: ' ',
        }));
        this.narrativeScroll.add(new TextRenderable(this.renderer, {
            id: `gameover-msg`,
            content: message,
        }));
        this.narrativeScroll.add(new TextRenderable(this.renderer, {
            id: `gameover-hint`,
            content: t`${fg(COLORS.textDim)('Press Enter to continue...')}`,
        }));
    }

    // ─── Inline Choice Cards ───────────────────────────────────────────────

    showChoiceCards(title: string, choices: { label: string; description: string }[]): void {
        this.dismissInlineChoices();

        const titleText = new TextRenderable(this.renderer, {
            id: `choice-title-${String(Date.now())}`,
            content: t`${bold(fg(COLORS.title)(title))}`,
        });

        const select = new SelectRenderable(this.renderer, {
            id: `choice-select-${String(Date.now())}`,
            options: choices.map((c, i) => ({
                name: `${String(i + 1)}. ${c.label}`,
                description: c.description,
                value: c.label,
            })),
            flexGrow: 1,
            selectedBackgroundColor: '#1e3a5f',
            selectedTextColor: '#00e5ff',
            textColor: COLORS.text,
            backgroundColor: '#0d1117',
            wrapSelection: true,
            showDescription: true,
        });

        select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
            this.selectInlineChoice();
        });

        const hint = new TextRenderable(this.renderer, {
            id: `choice-hint-${String(Date.now())}`,
            content: t`${fg(COLORS.textDim)('  Up/Down Navigate  Enter Select  Or type your own idea')}`,
        });

        const cardHeight = choices.length * 2 + 5;

        const card = new BoxRenderable(this.renderer, {
            id: `choice-card-${String(Date.now())}`,
            backgroundColor: '#0d1117',
            marginLeft: 1,
            marginRight: 1,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 0,
            height: cardHeight,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            flexDirection: 'column',
        });
        card.add(titleText);
        card.add(select);
        card.add(hint);
        this.narrativeScroll.add(card);

        this.inlineChoices = select;
        this.inlineChoicesCard = card;
        this.inlineChoicesActive = true;
    }

    private selectInlineChoice(): void {
        if (!this.inlineChoices) return;
        const selected = this.inlineChoices.getSelectedOption();
        if (!selected) return;

        const approach = selected.value as string;
        this.dismissInlineChoices();
        this.inputField.value = '';
        if (this.inputCallback) {
            this.inputCallback(approach);
        }
    }

    private dismissInlineChoices(): void {
        this.inlineChoicesActive = false;
        if (this.inlineChoicesCard) {
            this.inlineChoicesCard.visible = false;
            this.inlineChoicesCard = null;
        }
        this.inlineChoices = null;
    }

    // ─── Slash Commands ─────────────────────────────────────────────────────

    setSlashCommands(commands: SlashCommandDef[]): void {
        this.slashCommands = commands;
    }

    private updatePopupFromInput(): void {
        const value = this.inputField.value;

        // Not a slash command — dismiss if open
        if (!value.startsWith('/')) {
            if (this.popupState !== 'idle') this.dismissPopup();
            return;
        }

        if (this.popupState === 'idle' || this.popupState === 'command') {
            // Show/filter command list
            const typed = value.slice(1).toLowerCase(); // text after "/"
            const filtered = this.slashCommands
                .filter(c => c.name.startsWith(typed))
                .map(c => ({ name: c.name, description: c.description, value: c.name }));

            this.popupState = 'command';
            this.popupHint.content = t`${fg(COLORS.title)('/ Commands')}`;
            this.popupSelect.options = filtered;
            this.popupSelect.setSelectedIndex(0);
            this.popupBox.visible = true;
        } else if (this.selectedCommand) {
            // Filter target list (popupState === 'target')
            const prefix = `/${this.selectedCommand.name} `;
            const typed = value.startsWith(prefix) ? value.slice(prefix.length).toLowerCase() : '';
            const targets = this.selectedCommand.getTargets()
                .filter(tgt => tgt.label.toLowerCase().startsWith(typed))
                .map(tgt => ({ name: tgt.label, description: '', value: tgt.value }));

            this.popupSelect.options = targets;
            this.popupSelect.setSelectedIndex(0);
        }
    }

    private selectPopupItem(): void {
        const selected = this.popupSelect.getSelectedOption();
        if (!selected) return;

        if (this.popupState === 'command') {
            const cmd = this.slashCommands.find(c => c.name === selected.value);
            if (!cmd) return;

            if (cmd.needsTarget) {
                const targets = cmd.getTargets();
                if (targets.length > 0) {
                    // Enter target selection mode
                    this.selectedCommand = cmd;
                    this.popupState = 'target';
                    this.inputField.value = `/${cmd.name} `;
                    this.popupHint.content = t`${fg(COLORS.title)(`/ ${cmd.name} > target`)}`;
                    this.popupSelect.options = targets.map(tgt => ({
                        name: tgt.label, description: '', value: tgt.value,
                    }));
                    this.popupSelect.setSelectedIndex(0);
                    return;
                }
            }

            // No targets needed — submit immediately
            this.dismissPopup();
            this.inputField.value = '';
            const prompt = cmd.toPrompt();
            if (this.inputCallback) this.inputCallback(prompt);
        } else if (this.popupState === 'target' && this.selectedCommand) {
            const target = selected.value as string;
            const prompt = this.selectedCommand.toPrompt(target);
            this.dismissPopup();
            this.inputField.value = '';
            if (this.inputCallback) this.inputCallback(prompt);
        }
    }

    private dismissPopup(): void {
        this.popupState = 'idle';
        this.popupBox.visible = false;
        this.selectedCommand = null;
    }

    private translateSlashInput(input: string): string {
        if (!input.startsWith('/')) return input;

        const withoutSlash = input.slice(1);
        const spaceIdx = withoutSlash.indexOf(' ');
        const cmdName = spaceIdx === -1 ? withoutSlash.toLowerCase() : withoutSlash.slice(0, spaceIdx).toLowerCase();
        const arg = spaceIdx === -1 ? undefined : withoutSlash.slice(spaceIdx + 1).trim() || undefined;

        const cmd = this.slashCommands.find(c => c.name === cmdName);
        if (cmd) return cmd.toPrompt(arg);

        // Unknown slash command — send as-is without the "/"
        return withoutSlash;
    }

    // ─── Cleanup ────────────────────────────────────────────────────────────

    destroy(): void {
        this.renderer.destroy();
    }
}
