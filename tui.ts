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
    StyledText,
    RGBA,
    t,
    bold,
    fg,
    DistortionEffect,
} from '@opentui/core';
import type { CliRenderer, KeyEvent, TextChunk } from '@opentui/core';
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
import type { DisplaySegment } from './src/schema.js';
import {
    segmentCardStyle,
    truncateChunks,
    countChunkChars,
    chunksToStyledText,
} from './src/segment-style.js';

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

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

// ─── Markdown Theme ─────────────────────────────────────────────────────────

const mdTheme = SyntaxStyle.fromStyles({
    'markup.heading':     { fg: RGBA.fromHex('#00e5ff'), bold: true },
    'markup.bold':        { fg: RGBA.fromHex('#e0e8f0'), bold: true },
    'markup.italic':      { fg: RGBA.fromHex('#8abfff'), italic: true },
    'markup.quote':       { fg: RGBA.fromHex('#6aad8a'), italic: true },
    'markup.code':        { fg: RGBA.fromHex('#ff8844') },
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

function alertEffectHint(type: string, effect: string): string {
    // Keep this short; the alerts panel has limited width and height.
    switch (type) {
        case 'hull_breach': return '-5 SUIT/T';
        case 'radiation_spike': return '-3 HP/T';
        case 'power_failure': return 'SENSORS DOWN';
        case 'atmosphere_alarm': return '-2 O2/T';
        case 'coolant_leak': return 'CASCADE';
        case 'structural_alert': return '-5 SUIT/T';
        case 'distress_signal': return 'NEW PATH';
        case 'supply_cache': return 'SUPPLIES';
        default: return effect ? effect.toUpperCase() : '';
    }
}

function classIcon(cls: CharacterClassId): string {
    switch (cls) {
        case 'engineer': return '[E]';
        case 'scientist': return '[S]';
        case 'medic': return '[M]';
        case 'commander': return '[C]';
    }
}

// ─── System Panel Helpers ─────────────────────────────────────────────────────

const SYSTEM_ABBREV: Record<string, string> = {
    life_support: 'LifeSup',
    pressure_seal: 'Pressure',
    power_relay: 'PwrRelay',
    coolant_loop: 'Coolant',
    atmosphere_processor: 'AtmoProc',
    gravity_generator: 'Gravity',
    radiation_shielding: 'RadShld',
    communications: 'Comms',
    fire_suppression: 'FireSup',
    water_recycler: 'H2ORecyc',
    thermal_regulator: 'Thermal',
    structural_integrity: 'Struct',
};

const STATUS_BADGE: Record<string, string> = {
    critical: 'CRIT',
    offline: 'OFF',
    failing: 'FAIL',
    degraded: 'DEGR',
    nominal: 'NOM',
    repaired: 'OK',
};

function challengeDots(state: string): string {
    switch (state) {
        case 'detected': return '\u25CB\u25CB\u25CB\u25CB';       // ○○○○
        case 'characterized': return '\u25CF\u25CB\u25CB\u25CB';   // ●○○○
        case 'stabilized': return '\u25CF\u25CF\u25CB\u25CB';      // ●●○○
        default: return '\u25CB\u25CB\u25CB\u25CB';
    }
}

// ─── GameUI ──────────────────────────────────────────────────────────────────

// ─── Segment Card State ──────────────────────────────────────────────────────

interface SegmentCardState {
    chunks: TextChunk[];           // pre-styled, full content
    textNode: TextRenderable;      // the renderable in the card
    cardBox: BoxRenderable;        // the card container (deferred add to scroll)
    addedToScroll: boolean;        // whether cardBox has been added to narrativeScroll
    totalChars: number;            // total content char count
    revealedChars: number;         // typewriter position (float)
    revealAllowedChars: number;    // TTS-gated budget
    revealRate: number;            // chars/sec from TTS duration
    finalized: boolean;
}

export class GameUI {
    private renderer!: CliRenderer;
    private narrativeScroll!: ScrollBoxRenderable;
    private inputField!: InputRenderable;
    private inputCallback: ((input: string) => void) | null = null;
    private distortion = new DistortionEffect({ glitchChancePerSecond: 0.3, maxGlitchLines: 2 });
    private distortionFn = (buffer: Parameters<typeof this.distortion.apply>[0], deltaTime: number) => {
        this.distortion.apply(buffer, deltaTime);
    };

    // Sidebar panel text renderables
    private vitalsText!: TextRenderable;
    private locationText!: TextRenderable;
    private systemsText!: TextRenderable;
    private inventoryText!: TextRenderable;
    private missionText!: TextRenderable;
    private alertsPanel!: BoxRenderable;
    private alertsText!: TextRenderable;
    private sidebar!: BoxRenderable;

    // Compact fallback status (narrow terminals)
    private compactStatusText!: TextRenderable;
    private isNarrowMode = false;

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

    // Mission modal overlay
    private missionModalBox!: BoxRenderable;
    private missionModalScroll!: ScrollBoxRenderable;
    private missionModalVisible = false;
    private mapModalBox!: BoxRenderable;
    private mapModalScroll!: ScrollBoxRenderable;
    private mapModalVisible = false;
    private prevObjectiveStep = -1;
    private prevObjectivesComplete = false;
    private lastStatus: GameStatus | null = null;

    // Per-segment card reveal state
    private segmentCards: SegmentCardState[] = [];
    private revealTimer: ReturnType<typeof setInterval> | null = null;
    private inputBar!: BoxRenderable;
    private spinnerBar: BoxRenderable | null = null;
    private spinnerTimer: ReturnType<typeof setInterval> | null = null;
    private revealFirstChunk = true;
    private debugLog: ((label: string, content: string) => void) | null = null;

    // Layout root ref for screen swaps
    private layoutRoot!: BoxRenderable;

    async init(): Promise<void> {
        this.renderer = await createCliRenderer({
            exitOnCtrlC: true,
            useAlternateScreen: true,
            targetFps: 30,
            // Ghostty + kitty keyboard protocol sends F1–F4 as CSI-letter form
            // (\x1b[P .. \x1b[S) which @opentui/core's key parser doesn't map.
            // Intercept these raw sequences before the parser sees them.
            prependInputHandlers: [
                (seq: string): boolean => {
                    const m = /^\x1b\[(?:1(?:;(\d+))?)?([PQRS])$/.exec(seq);
                    if (!m) return false;
                    const modBits = m[1] ? parseInt(m[1], 10) - 1 : 0;
                    if (modBits !== 0) return false; // Only handle unmodified presses
                    const letter = m[2];
                    if (letter === 'P') { this.handleF1Action(); return true; }
                    if (letter === 'Q') { this.handleF2Action(); return true; }
                    return false; // F3/F4 — pass through
                },
            ],
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

        // Sidebar panel text renderables
        this.vitalsText = new TextRenderable(this.renderer, {
            id: 'vitals-text',
            content: t`${fg(COLORS.textDim)('...')}`,
        });
        this.locationText = new TextRenderable(this.renderer, {
            id: 'location-text',
            content: t`${fg(COLORS.textDim)('...')}`,
        });
        this.systemsText = new TextRenderable(this.renderer, {
            id: 'systems-text',
            content: t`${fg(COLORS.hpGood)('All nominal')}`,
        });
        this.inventoryText = new TextRenderable(this.renderer, {
            id: 'inventory-text',
            content: t`${fg(COLORS.textDim)('Empty')}`,
        });
        this.missionText = new TextRenderable(this.renderer, {
            id: 'mission-text',
            content: t`${fg(COLORS.textDim)('...')}`,
        });
        this.alertsText = new TextRenderable(this.renderer, {
            id: 'alerts-text',
            content: t`${fg(COLORS.textDim)('None')}`,
        });

        // Compact fallback status for narrow terminals
        this.compactStatusText = new TextRenderable(this.renderer, {
            id: 'compact-status-text',
            content: t`${fg(COLORS.textDim)('Initializing...')}`,
        });

        this.inputField = new InputRenderable(this.renderer, {
            id: 'input-field',
            flexGrow: 1,
            placeholder: 'Enter your command...',
            backgroundColor: COLORS.inputBg,
            focusedBackgroundColor: COLORS.inputFocusBg,
            textColor: COLORS.inputText,
            cursorColor: COLORS.cursor,
        });

        // Wire up input Enter event
        this.inputField.on(InputRenderableEvents.ENTER, (value: string) => {
            const trimmed = value.trim();
            if (!trimmed) return;

            // If popup is active, let selectPopupItem handle it
            if (this.popupState !== 'idle') return;

            this.inputField.value = '';

            // /mission opens the mission modal
            if (trimmed.toLowerCase() === '/mission') {
                this.showMissionModal();
                return;
            }
            // /map opens the map modal
            if (trimmed.toLowerCase() === '/map') {
                this.showMapModal();
                return;
            }

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
            // Map modal takes top priority
            if (this.mapModalVisible) {
                if (key.name === 'escape') { this.dismissMapModal(); return true; }
                const keyName = key.name.toLowerCase();
                if (keyName === 'f1') { this.handleF1Action(); return true; }
                if (keyName === 'f2') { this.handleF2Action(); return true; }
                if (this.mapModalScroll.handleKeyPress(key)) return true;
                return true; // Block typing while modal is open
            }

            // Mission modal takes top priority
            if (this.missionModalVisible) {
                if (key.name === 'escape') { this.dismissMissionModal(); return true; }
                const keyName = key.name.toLowerCase();
                if (keyName === 'f1') { this.handleF1Action(); return true; }
                if (keyName === 'f2') { this.handleF2Action(); return true; }
                if (this.missionModalScroll.handleKeyPress(key)) return true;
                return true; // Block all input while modal is open
            }

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

            // F1/F2 open map/mission modals (guards inside the action methods)
            const keyName = key.name.toLowerCase();
            if (keyName === 'f1') { this.handleF1Action(); return true; }
            if (keyName === 'f2') { this.handleF2Action(); return true; }

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

        // Mission modal overlay
        this.missionModalScroll = new ScrollBoxRenderable(this.renderer, {
            id: 'mission-modal-scroll',
            flexGrow: 1,
            width: '100%',
            scrollY: true,
            stickyScroll: false,
            contentOptions: { flexDirection: 'column', gap: 0 },
        });

        this.missionModalBox = new BoxRenderable(this.renderer, {
            id: 'mission-modal-box',
            position: 'absolute',
            bottom: 3,
            left: '20%',
            width: '60%',
            borderStyle: 'rounded',
            borderColor: COLORS.title,
            backgroundColor: '#0d1117',
            zIndex: 11,
            visible: false,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1,
            paddingBottom: 1,
        });
        this.missionModalBox.add(this.missionModalScroll);
        this.renderer.root.add(this.missionModalBox);

        // Map modal overlay
        this.mapModalScroll = new ScrollBoxRenderable(this.renderer, {
            id: 'map-modal-scroll',
            flexGrow: 1,
            width: '100%',
            scrollY: true,
            scrollX: true,
            stickyScroll: false,
            contentOptions: { flexDirection: 'column', gap: 0 },
        });

        this.mapModalBox = new BoxRenderable(this.renderer, {
            id: 'map-modal-box',
            position: 'absolute',
            bottom: 3,
            left: '10%',
            width: '80%',
            height: '70%',
            borderStyle: 'rounded',
            borderColor: COLORS.title,
            backgroundColor: '#0d1117',
            zIndex: 12,
            visible: false,
            flexDirection: 'column',
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1,
            paddingBottom: 1,
        });
        this.mapModalBox.add(this.mapModalScroll);
        this.renderer.root.add(this.mapModalBox);

        this.inputField.focus();
    }

    private buildGameplayLayout(): void {
        this.isNarrowMode = process.stdout.columns < 90;

        // Main narrative panel
        const narrativePanel = Box(
            {
                flexGrow: 1,
                flexDirection: 'column',
                borderStyle: 'double',
                borderColor: COLORS.border,
                title: ' STATION OMEGA ',
                titleAlignment: 'center',
                backgroundColor: COLORS.panelBg,
            },
            this.narrativeScroll,
        );

        // Input area (BoxRenderable so we can remove/re-add for spinner swap)
        this.inputBar = new BoxRenderable(this.renderer, {
            id: 'input-bar',
            height: 1,
            width: '100%',
            flexDirection: 'row',
            paddingLeft: 1,
        });
        this.inputBar.add(Text({ content: t`${fg(COLORS.title)('>')} ` }));
        this.inputBar.add(this.inputField);
        this.inputBar.add(Text({ content: t` ${fg(COLORS.textDim)('F1:Map  F2:Mission  /:Commands')} `, paddingRight: 1 }));

        if (this.isNarrowMode) {
            // Narrow terminal: no sidebar, compact status bar below narrative
            const compactBar = Box(
                {
                    height: 1,
                    width: '100%',
                    flexDirection: 'row',
                    backgroundColor: COLORS.border,
                    paddingLeft: 1,
                    paddingRight: 1,
                },
                this.compactStatusText,
            );
            this.layoutRoot.add(narrativePanel);
            this.layoutRoot.add(compactBar);
            this.layoutRoot.add(this.inputBar);
            return;
        }

        // ── Sidebar panels ──────────────────────────────────────────────

        const sidebarPanelBorder = COLORS.border;
        const sidebarPanelBg = COLORS.panelBg;

        const vitalsPanel = new BoxRenderable(this.renderer, {
            id: 'sb-vitals',
            height: 6,
            width: '100%',
            borderStyle: 'single',
            borderColor: sidebarPanelBorder,
            title: ' VITALS ',
            titleAlignment: 'center',
            backgroundColor: sidebarPanelBg,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: 'column',
        });
        vitalsPanel.add(this.vitalsText);

        const locationPanel = new BoxRenderable(this.renderer, {
            id: 'sb-location',
            height: 5,
            width: '100%',
            borderStyle: 'single',
            borderColor: sidebarPanelBorder,
            title: ' LOCATION ',
            titleAlignment: 'center',
            backgroundColor: sidebarPanelBg,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: 'column',
        });
        locationPanel.add(this.locationText);

        const systemsPanel = new BoxRenderable(this.renderer, {
            id: 'sb-systems',
            height: 5,
            width: '100%',
            borderStyle: 'single',
            borderColor: sidebarPanelBorder,
            title: ' SYSTEMS ',
            titleAlignment: 'center',
            backgroundColor: sidebarPanelBg,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: 'column',
        });
        systemsPanel.add(this.systemsText);

        const inventoryPanel = new BoxRenderable(this.renderer, {
            id: 'sb-inventory',
            flexGrow: 1,
            width: '100%',
            borderStyle: 'single',
            borderColor: sidebarPanelBorder,
            title: ' INVENTORY ',
            titleAlignment: 'center',
            backgroundColor: sidebarPanelBg,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: 'column',
        });
        inventoryPanel.add(this.inventoryText);

        const missionPanel = new BoxRenderable(this.renderer, {
            id: 'sb-mission',
            height: 5,
            width: '100%',
            borderStyle: 'single',
            borderColor: sidebarPanelBorder,
            title: ' MISSION ',
            titleAlignment: 'center',
            backgroundColor: sidebarPanelBg,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: 'column',
        });
        missionPanel.add(this.missionText);

        this.alertsPanel = new BoxRenderable(this.renderer, {
            id: 'sb-alerts',
            height: 4,
            width: '100%',
            borderStyle: 'single',
            borderColor: sidebarPanelBorder,
            title: ' ALERTS ',
            titleAlignment: 'center',
            backgroundColor: sidebarPanelBg,
            paddingLeft: 1,
            paddingRight: 1,
            flexDirection: 'column',
            visible: false,
        });
        this.alertsPanel.add(this.alertsText);

        // Sidebar container
        this.sidebar = new BoxRenderable(this.renderer, {
            id: 'sidebar',
            width: 28,
            flexDirection: 'column',
            backgroundColor: COLORS.bg,
        });
        this.sidebar.add(vitalsPanel);
        this.sidebar.add(locationPanel);
        this.sidebar.add(systemsPanel);
        this.sidebar.add(inventoryPanel);
        this.sidebar.add(this.alertsPanel);
        this.sidebar.add(missionPanel);

        // Main row: narrative + sidebar
        const mainRow = new BoxRenderable(this.renderer, {
            id: 'main-row',
            flexGrow: 1,
            flexDirection: 'row',
            width: '100%',
        });
        mainRow.add(narrativePanel);
        mainRow.add(this.sidebar);

        this.layoutRoot.add(mainRow);
        this.layoutRoot.add(this.inputBar);
    }

    private clearLayout(): void {
        for (const child of this.layoutRoot.getChildren()) {
            this.layoutRoot.remove(child.id);
        }
    }

    // ─── Title Screen ───────────────────────────────────────────────────────

    showTitleScreen(options: {
        showVoiceSetup?: boolean;
        showVoiceToggle?: boolean;
        voiceEnabled?: boolean;
    } = {}): Promise<'new_run' | 'history' | 'voice_setup' | 'voice_toggle' | 'quit'> {
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

        const menuOptions = [
            { name: 'New Run', description: 'Begin a new expedition into Station Omega', value: 'new_run' },
            { name: 'Run History', description: 'View past expedition logs', value: 'history' },
        ];
        if (options.showVoiceToggle) {
            const label = options.voiceEnabled ? 'Voice: ON' : 'Voice: OFF';
            menuOptions.push({ name: label, description: 'Enable/Disable voice narration', value: 'voice_toggle' });
        } else if (options.showVoiceSetup) {
            menuOptions.push({ name: 'Voice Setup', description: 'Enter Inworld API key for voice narration', value: 'voice_setup' });
        }
        menuOptions.push({ name: 'Quit', description: 'Exit the game', value: 'quit' });

        const menu = new SelectRenderable(this.renderer, {
            id: 'title-menu',
            options: menuOptions,
            height: menuOptions.length * 2,
            width: '60%',
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
            width: '100%',
            paddingLeft: 3,
            paddingRight: 3,
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
                resolve(selected.value as 'new_run' | 'history' | 'voice_setup' | 'voice_toggle' | 'quit');
            });
        });
    }

    // ─── API Key Entry Screen ─────────────────────────────────────────────

    showApiKeyEntry(): Promise<string | null> {
        this.clearLayout();

        const header = new TextRenderable(this.renderer, {
            id: 'apikey-header',
            content: t`${bold(fg(COLORS.title)('VOICE SETUP'))}`,
        });

        const desc = new TextRenderable(this.renderer, {
            id: 'apikey-desc',
            content: t`${fg(COLORS.text)('Enter your Inworld API key to enable voice narration.')}\n${fg(COLORS.textDim)('Leave blank and press Enter to skip.')}`,
        });

        const input = new InputRenderable(this.renderer, {
            id: 'apikey-input',
            width: 60,
            backgroundColor: COLORS.inputBg,
            focusedBackgroundColor: COLORS.inputFocusBg,
            textColor: COLORS.inputText,
            cursorColor: COLORS.cursor,
            placeholder: 'base64 credentials...',
        });

        const container = new BoxRenderable(this.renderer, {
            id: 'apikey-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
        });
        container.add(header);
        container.add(desc);
        container.add(input);

        this.layoutRoot.add(container);
        input.focus();

        return new Promise((resolve) => {
            input.on(InputRenderableEvents.ENTER, (value: string) => {
                const trimmed = value.trim();
                resolve(trimmed || null);
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
            const profs = build.proficiencies.join(', ');
            const weaks = build.weaknesses.join(', ');
            const startItem = build.startingItem ?? 'none';
            previewText.content = t`${fg(COLORS.text)(`HP: ${String(build.baseHp)}  INV: ${String(build.maxInventory)} slots`)}\n${fg(COLORS.hpGood)(`+ ${profs}`)}  ${fg(COLORS.hpLow)(`- ${weaks}`)}\n${fg(COLORS.textDim)(`Starting item: ${startItem}`)}`;
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
        this.prevObjectiveStep = -1;
        this.prevObjectivesComplete = false;
        this.lastStatus = null;
        this.dismissMissionModal();
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
            { label: 'Engineering   ', value: score.engineeringEfficiency },
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
            content: t`${fg(COLORS.textDim)('Turns:')} ${fg(COLORS.text)(String(metrics.turnCount))}  ${fg(COLORS.textDim)('Time:')} ${fg(COLORS.text)(formatDuration(duration))}  ${fg(COLORS.textDim)('Repaired:')} ${fg(COLORS.text)(String(metrics.systemsRepaired))}  ${fg(COLORS.textDim)('Rooms:')} ${fg(COLORS.text)(String(metrics.roomsVisited.size))}`,
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

    /** Show a brief message with "Press Enter to continue..." */
    showBriefMessage(message: string): Promise<void> {
        this.clearLayout();

        const container = new BoxRenderable(this.renderer, {
            id: 'brief-container',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: COLORS.bg,
            borderStyle: 'rounded',
            borderColor: COLORS.border,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
        });

        container.add(new TextRenderable(this.renderer, {
            id: 'brief-msg',
            content: t`${fg(COLORS.text)(message)}`,
        }));
        container.add(new TextRenderable(this.renderer, {
            id: 'brief-hint',
            content: t`${fg(COLORS.textDim)('Press Enter to continue...')}`,
        }));

        const tempInput = new InputRenderable(this.renderer, {
            id: 'brief-input',
            width: 0 as unknown as number,
            backgroundColor: COLORS.bg,
            textColor: COLORS.bg,
            cursorColor: COLORS.bg,
        });
        container.add(tempInput);
        this.layoutRoot.add(container);
        tempInput.focus();

        return new Promise((resolve) => {
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

    appendNarrative(text: string): void {
        const md = new MarkdownRenderable(this.renderer, {
            id: `narrative-${String(Date.now())}`,
            content: text.replace(/\n\n/g, '\n\n\u2800\n\n'),
            syntaxStyle: mdTheme,
            streaming: false,
        });
        this.addCard(md, COLORS.cardBg);
    }

    /**
     * Create a per-segment card with typed header and pre-styled text.
     * The card's text content starts empty and is revealed by revealChunk().
     */
    pushSegmentCard(seg: DisplaySegment, chunks: TextChunk[], headerChars = 0): void {
        const style = segmentCardStyle(seg.type);
        const totalChars = countChunkChars(chunks);

        // Create content TextRenderable — show header immediately if present
        const initialContent = headerChars > 0
            ? chunksToStyledText(truncateChunks(chunks, headerChars))
            : '';
        const textNode = new TextRenderable(this.renderer, {
            id: `seg-text-${String(Date.now())}-${String(seg.segmentIndex)}`,
            content: initialContent,
        });

        // Build card box with segment-type styling
        const cardOpts: ConstructorParameters<typeof BoxRenderable>[1] = {
            id: `seg-card-${String(Date.now())}-${String(seg.segmentIndex)}`,
            backgroundColor: style.bgColor,
            marginLeft: 1,
            marginRight: 1,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 1,
            flexDirection: 'column' as const,
        };

        if (style.borderColor) {
            cardOpts.borderColor = style.borderColor;
            cardOpts.borderStyle = style.borderStyle ?? 'single';
        }

        const card = new BoxRenderable(this.renderer, cardOpts);
        card.add(textNode);

        // Defer adding card to scroll — it will appear when revealChunk() first targets it
        this.segmentCards.push({
            chunks,
            textNode,
            cardBox: card,
            addedToScroll: false,
            totalChars,
            revealedChars: headerChars,
            revealAllowedChars: headerChars,
            revealRate: 60,
            finalized: false,
        });

        this.debugLog?.('UI-PUSH-CARD', `seg[${String(seg.segmentIndex)}] type=${seg.type} speaker=${seg.speakerName ?? 'none'} totalChars=${String(totalChars)} headerChars=${String(headerChars)}`);
    }

    /** Remove all segment cards from a failed turn without revealing them. */
    discardTurnCards(): void {
        this.debugLog?.('UI-DISCARD', `Discarding ${String(this.segmentCards.length)} cards`);
        this.stopRevealTimer();
        for (const card of this.segmentCards) {
            if (card.addedToScroll) {
                this.narrativeScroll.remove(card.cardBox.id);
            }
        }
        this.segmentCards = [];
        this.revealFirstChunk = true;
    }

    /** Instantly reveal all remaining text in all segment cards and reset state. */
    finalizeAllCards(): void {
        this.debugLog?.('UI-FINALIZE', `Finalizing ${String(this.segmentCards.length)} cards`);
        this.stopRevealTimer();
        this.hideTypingIndicator();

        for (const card of this.segmentCards) {
            if (!card.addedToScroll) {
                this.narrativeScroll.add(card.cardBox);
                card.addedToScroll = true;
            }
            if (!card.finalized) {
                card.revealedChars = card.totalChars;
                card.finalized = true;
                card.textNode.content = chunksToStyledText(card.chunks);
            }
        }

        // Reset for next response
        this.segmentCards = [];
        this.revealFirstChunk = true;
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

    // ─── Sidebar Updates ──────────────────────────────────────────────────

    updateStatus(status: GameStatus): void {
        this.detectObjectiveChanges(status);
        this.lastStatus = status;
        if (this.isNarrowMode) {
            this.updateCompactStatus(status);
            return;
        }
        this.updateVitals(status);
        this.updateLocation(status);
        this.updateSystems(status);
        this.updateInventory(status);
        this.updateMission(status);
        this.updateAlerts(status);
    }

    private updateCompactStatus(status: GameStatus): void {
        const hpPct = status.hp / status.maxHp;
        const hpColor = hpPct >= 0.6 ? COLORS.hpGood : hpPct >= 0.25 ? COLORS.hpMid : COLORS.hpLow;
        const inv = status.inventory.length > 0 ? status.inventory.join(', ') : 'empty';
        const cls = classIcon(status.characterClass);
        this.compactStatusText.content = t`${fg(hpColor)(`HP ${String(status.hp)}/${String(status.maxHp)}`)}  ${fg(COLORS.textDim)('|')}  ${fg(COLORS.text)(`${cls} ${status.roomName}`)} ${fg(COLORS.textDim)(`(${String(status.roomIndex)}/${String(status.totalRooms)})`)}  ${fg(COLORS.textDim)('|')}  ${fg(COLORS.textDim)(`T${String(status.turnCount)}`)}  ${fg(COLORS.textDim)('|')}  ${fg(COLORS.text)(`Inv: ${inv}`)}`;
    }

    private updateVitals(status: GameStatus): void {
        const hpPct = status.hp / status.maxHp;
        const hpColor = hpPct >= 0.6 ? COLORS.hpGood : hpPct >= 0.25 ? COLORS.hpMid : COLORS.hpLow;
        const hpLabel = hpPct >= 0.8 ? 'Healthy'
            : hpPct >= 0.5 ? 'Wounded'
            : hpPct >= 0.25 ? 'Critical'
            : 'Dying';

        const barW = 14;
        const filled = Math.round(hpPct * barW);
        const hpBar = '\u2588'.repeat(filled) + '\u2591'.repeat(barW - filled);

        const cls = classIcon(status.characterClass);

        // Oxygen and suit integrity indicators
        const o2Pct = status.maxOxygen > 0 ? status.oxygen / status.maxOxygen : 1;
        const o2Color = o2Pct >= 0.6 ? COLORS.hpGood : o2Pct >= 0.25 ? COLORS.hpMid : COLORS.hpLow;
        const suitColor = status.suitIntegrity >= 60 ? COLORS.hpGood : status.suitIntegrity >= 25 ? COLORS.hpMid : COLORS.hpLow;

        this.vitalsText.content = t`${fg(COLORS.text)(`${cls} ${hpLabel}`)}\n${fg(hpColor)(`HP ${hpBar} ${String(status.hp)}`)}\n${fg(o2Color)(`O2 ${String(status.oxygen)}%`)}  ${fg(suitColor)(`Suit ${String(status.suitIntegrity)}%`)}`;
    }

    private updateLocation(status: GameStatus): void {
        this.locationText.content = t`${fg(COLORS.text)(status.roomName)}\n${fg(COLORS.textDim)(`Room ${String(status.roomIndex)}/${String(status.totalRooms)}`)}\n${fg(COLORS.textDim)(`Turn ${String(status.turnCount)}`)}`;
    }

    private updateSystems(status: GameStatus): void {
        const active = status.systemFailures.filter(f => f.challengeState !== 'resolved' && f.challengeState !== 'failed');
        if (active.length === 0) {
            this.systemsText.content = t`${fg(COLORS.hpGood)('All nominal')}`;
            return;
        }

        const maxSystems = 4;
        const lines: TextChunk[][] = [];
        for (let i = 0; i < Math.min(active.length, maxSystems); i++) {
            const f = active[i];
            const abbrev = SYSTEM_ABBREV[f.systemId] ?? f.systemId.slice(0, 8);
            const sev = '\u25B2'.repeat(f.severity);
            const badge = STATUS_BADGE[f.status] ?? f.status.slice(0, 4).toUpperCase();
            const badgeColor = f.status === 'critical' || f.status === 'offline'
                ? COLORS.hpLow
                : f.status === 'failing'
                    ? '#ff8844'
                    : f.status === 'degraded'
                        ? COLORS.hpMid
                        : COLORS.hpGood;

            // Cascade timer or challenge progress
            let trail: string;
            if (f.turnsUntilCascade <= 3) {
                trail = `\u26A1${String(f.turnsUntilCascade)}T`;
            } else {
                trail = challengeDots(f.challengeState);
            }

            lines.push([
                fg(COLORS.text)(abbrev.padEnd(8)),
                fg(badgeColor)(` ${sev.padEnd(3)} ${badge.padEnd(4)} `),
                fg(COLORS.textDim)(trail),
            ]);
        }

        const chunks: TextChunk[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (i > 0) chunks.push(fg(COLORS.text)('\n'));
            chunks.push(...lines[i]);
        }
        this.systemsText.content = new StyledText(chunks);
    }

    private updateInventory(status: GameStatus): void {
        if (status.inventory.length === 0) {
            this.inventoryText.content = t`${fg(COLORS.textDim)('Empty')}\n${fg(COLORS.textDim)(`[0/${String(status.maxInventory)}]`)}`;
            return;
        }

        const itemLines = status.inventory.map((name, i) => {
            const isKey = status.inventoryKeyFlags[i];
            const prefix = isKey ? '*' : String(i + 1);
            return `${prefix} ${name}`;
        });
        const slotLabel = `[${String(status.inventory.length)}/${String(status.maxInventory)}]`;
        this.inventoryText.content = t`${fg(COLORS.text)(itemLines.join('\n'))}\n${fg(COLORS.textDim)(slotLabel)}`;
    }

    private updateMission(status: GameStatus): void {
        const title = status.objectiveTitle.length > 22
            ? status.objectiveTitle.slice(0, 22) + '..'
            : status.objectiveTitle;

        if (status.objectivesComplete) {
            this.missionText.content = t`${fg(COLORS.hpGood)('COMPLETE')}\n${fg(COLORS.textDim)(title)}`;
            return;
        }

        const completed = status.objectiveSteps.filter(s => s.completed).length;
        const total = status.objectiveTotal;
        const barW = 10;
        const filled = total > 0 ? Math.round((completed / total) * barW) : 0;
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barW - filled);

        this.missionText.content = t`${fg(COLORS.textDim)(title)}\n${fg(COLORS.title)(bar)} ${fg(COLORS.text)(`${String(completed)}/${String(total)}`)}\n${fg(COLORS.textDim)('F2: details')}`;
    }

    private updateAlerts(status: GameStatus): void {
        if (status.activeEvents.length === 0) {
            this.alertsPanel.visible = false;
            return;
        }

        this.alertsPanel.visible = true;
        this.alertsPanel.borderColor = COLORS.hpLow;

        // Render each alert as two explicit lines to avoid awkward auto-wrapping (e.g. "(-5" / "HP/T)").
        const lines: string[] = [];
        for (const e of status.activeEvents) {
            const label = e.type.replace(/_/g, ' ').toUpperCase();
            const turns = `${String(e.turnsRemaining)}T`;
            const hint = alertEffectHint(e.type, e.effect);
            lines.push(`\u26A0 ${label}`);
            lines.push(hint ? `  ${turns}  ${hint}` : `  ${turns}`);
        }

        // Box border consumes 2 rows (top+bottom). Keep enough room for our content lines.
        this.alertsPanel.height = Math.max(4, lines.length + 2);
        this.alertsText.content = t`${fg(COLORS.hpLow)(lines.join('\n'))}`;
    }

    // ─── F-Key Actions ────────────────────────────────────────────────────

    /** Toggle map modal (F1): close if showing map, switch from mission, or open fresh. */
    private handleF1Action(): void {
        if (this.mapModalVisible) {
            this.dismissMapModal();
        } else if (this.missionModalVisible) {
            this.dismissMissionModal();
            this.showMapModal();
        } else if (!this.inputField.value.trim() && this.popupState === 'idle' && !this.inlineChoicesActive) {
            this.showMapModal();
        }
    }

    /** Toggle mission modal (F2): close if showing mission, switch from map, or open fresh. */
    private handleF2Action(): void {
        if (this.missionModalVisible) {
            this.dismissMissionModal();
        } else if (this.mapModalVisible) {
            this.dismissMapModal();
            this.showMissionModal();
        } else if (!this.inputField.value.trim() && this.popupState === 'idle' && !this.inlineChoicesActive) {
            this.showMissionModal();
        }
    }

    // ─── Mission Modal ─────────────────────────────────────────────────────

    private showMissionModal(): void {
        const status = this.lastStatus;
        if (!status) return;

        // Clear previous modal content
        for (const child of this.missionModalScroll.getChildren()) {
            this.missionModalScroll.remove(child.id);
        }

        // Title
        const titleText = new TextRenderable(this.renderer, {
            id: 'mission-modal-title',
            content: t`${bold(fg(COLORS.title)(status.objectiveTitle))}`,
        });
        this.missionModalScroll.add(titleText);

        // Spacer
        this.missionModalScroll.add(new TextRenderable(this.renderer, {
            id: 'mission-modal-spacer',
            content: ' ',
        }));

        // Steps
        for (let i = 0; i < status.objectiveSteps.length; i++) {
            const step = status.objectiveSteps[i];
            let icon: string;
            let color: string;
            if (step.completed) {
                icon = '\u2713'; // ✓
                color = COLORS.hpGood;
            } else if (i === status.objectiveStep) {
                icon = '\u2192'; // →
                color = COLORS.title;
            } else {
                icon = '\u00B7'; // ·
                color = COLORS.textDim;
            }
            this.missionModalScroll.add(new TextRenderable(this.renderer, {
                id: `mission-modal-step-${String(i)}`,
                content: t`${fg(color)(`  ${icon} ${step.description}`)}`,
            }));
        }

        // Progress summary
        const completedCount = status.objectiveSteps.filter(s => s.completed).length;
        this.missionModalScroll.add(new TextRenderable(this.renderer, {
            id: 'mission-modal-spacer2',
            content: ' ',
        }));
        this.missionModalScroll.add(new TextRenderable(this.renderer, {
            id: 'mission-modal-progress',
            content: t`${fg(COLORS.textDim)(`  Progress: ${String(completedCount)}/${String(status.objectiveSteps.length)}  |  Escape to close`)}`,
        }));

        this.missionModalBox.visible = true;
        this.missionModalVisible = true;
    }

    private dismissMissionModal(): void {
        this.missionModalBox.visible = false;
        this.missionModalVisible = false;
    }

    // ─── Map Modal ─────────────────────────────────────────────────────────

    private showMapModal(): void {
        const status = this.lastStatus;
        if (!status) return;

        // Clear previous modal content
        for (const child of this.mapModalScroll.getChildren()) {
            this.mapModalScroll.remove(child.id);
        }

        const titleText = new TextRenderable(this.renderer, {
            id: 'map-modal-title',
            content: t`${bold(fg(COLORS.title)('STATION MAP'))} ${fg(COLORS.textDim)('(visited areas)')}`,
        });
        this.mapModalScroll.add(titleText);

        this.mapModalScroll.add(new TextRenderable(this.renderer, {
            id: 'map-modal-spacer',
            content: ' ',
        }));

        this.mapModalScroll.add(new TextRenderable(this.renderer, {
            id: 'map-modal-content',
            content: new StyledText(status.mapText),
        }));

        this.mapModalScroll.add(new TextRenderable(this.renderer, {
            id: 'map-modal-spacer2',
            content: ' ',
        }));
        this.mapModalScroll.add(new TextRenderable(this.renderer, {
            id: 'map-modal-hint',
            content: t`${fg(COLORS.textDim)('Arrow keys: scroll  |  Esc: close')}`,
        }));

        this.mapModalScroll.scrollTo({ x: 0, y: 0 });
        this.mapModalBox.visible = true;
        this.mapModalVisible = true;
    }

    private dismissMapModal(): void {
        this.mapModalBox.visible = false;
        this.mapModalVisible = false;
    }

    // ─── Narrative Mission Cards ────────────────────────────────────────────

    private detectObjectiveChanges(status: GameStatus): void {
        // First call — initialize tracking
        if (this.prevObjectiveStep === -1) {
            this.prevObjectiveStep = status.objectiveStep;
            this.prevObjectivesComplete = status.objectivesComplete;
            return;
        }

        // Mission complete
        if (status.objectivesComplete && !this.prevObjectivesComplete) {
            this.injectMissionCard('complete', 'MISSION COMPLETE');
            this.prevObjectivesComplete = true;
            this.prevObjectiveStep = status.objectiveStep;
            return;
        }

        // Objective advanced
        if (status.objectiveStep > this.prevObjectiveStep) {
            const prevDesc = status.objectiveSteps[this.prevObjectiveStep]?.description ?? '';
            this.injectMissionCard('done', `OBJECTIVE COMPLETE: ${prevDesc}`);

            const newDesc = status.objectiveSteps[status.objectiveStep]?.description ?? '';
            if (newDesc) {
                this.injectMissionCard('new', `NEW OBJECTIVE: ${newDesc}`);
            }

            this.prevObjectiveStep = status.objectiveStep;
        }
    }

    private injectMissionCard(type: 'done' | 'new' | 'complete', text: string): void {
        let icon: string;
        let borderColor: string;
        if (type === 'complete') {
            icon = '\u2605'; // ★
            borderColor = COLORS.hpGood;
        } else if (type === 'done') {
            icon = '\u2713'; // ✓
            borderColor = COLORS.hpGood;
        } else {
            icon = '\u25B6'; // ▶
            borderColor = COLORS.title;
        }

        const textColor = type === 'complete' ? COLORS.hpGood : type === 'done' ? COLORS.hpGood : COLORS.title;

        const content = new TextRenderable(this.renderer, {
            id: `mission-card-text-${String(Date.now())}-${String(Math.random()).slice(2, 6)}`,
            content: t`${fg(textColor)(`${icon} ${text}`)}`,
        });

        const card = new BoxRenderable(this.renderer, {
            id: `mission-card-${String(Date.now())}-${String(Math.random()).slice(2, 6)}`,
            backgroundColor: '#1a2f1a',
            marginLeft: 1,
            marginRight: 1,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 0,
            paddingBottom: 0,
            borderStyle: 'single',
            borderColor,
        });
        card.add(content);
        this.narrativeScroll.add(card);
    }

    // ─── Typing Indicator ─────────────────────────────────────────────────

    showTypingIndicator(): void {
        this.hideTypingIndicator();

        const spinnerText = new TextRenderable(this.renderer, {
            id: 'spinner-text',
            content: t`${fg(COLORS.title)(SPINNER_FRAMES[0])} ${fg(COLORS.textDim)('Uplink active...')}`,
        });

        this.spinnerBar = new BoxRenderable(this.renderer, {
            id: 'spinner-bar',
            height: 1,
            width: '100%',
            flexDirection: 'row',
            paddingLeft: 1,
        });
        this.spinnerBar.add(Text({ content: t`${fg(COLORS.title)('>')} ` }));
        this.spinnerBar.add(spinnerText);

        // Blur input so the terminal cursor hides
        this.inputField.blur();

        // Swap: remove input bar, add spinner bar in its place
        this.layoutRoot.remove(this.inputBar.id);
        this.layoutRoot.add(this.spinnerBar);

        let frameIdx = 0;
        this.spinnerTimer = setInterval(() => {
            frameIdx = (frameIdx + 1) % SPINNER_FRAMES.length;
            spinnerText.content = t`${fg(COLORS.title)(SPINNER_FRAMES[frameIdx])} ${fg(COLORS.textDim)('Uplink active...')}`;
        }, SPINNER_INTERVAL_MS);
    }

    hideTypingIndicator(): void {
        if (this.spinnerTimer) {
            clearInterval(this.spinnerTimer);
            this.spinnerTimer = null;
        }
        if (this.spinnerBar) {
            this.layoutRoot.remove(this.spinnerBar.id);
            this.spinnerBar = null;
        }
        // Restore the input bar and re-focus
        this.layoutRoot.add(this.inputBar);
        this.inputField.focus();
    }

    // ─── TTS-Gated Typewriter Reveal (Per-Segment Card) ────────────────

    /**
     * Called by TTS playback pump when a chunk starts playing.
     * Routes to the correct segment card's reveal state.
     */
    revealChunk(segmentIndex: number, charBudget: number, durationSec: number): void {
        // On first chunk reveal, hide the typing indicator
        if (this.revealFirstChunk) {
            this.hideTypingIndicator();
            this.revealFirstChunk = false;
        }

        if (charBudget <= 0) return;
        if (segmentIndex < 0 || segmentIndex >= this.segmentCards.length) {
            this.debugLog?.('UI-REVEAL-WARN', `Out-of-range segmentIndex=${String(segmentIndex)}, cards=${String(this.segmentCards.length)}`);
            return;
        }

        const card = this.segmentCards[segmentIndex];
        if (card.finalized) return;

        // Add card to scroll on first reveal so the box only appears when typing begins
        if (!card.addedToScroll) {
            this.narrativeScroll.add(card.cardBox);
            card.addedToScroll = true;
        }

        // Compute how many additional characters this TTS chunk allows
        card.revealAllowedChars = Math.min(card.revealAllowedChars + charBudget, card.totalChars);
        card.revealRate = charBudget / Math.max(durationSec, 0.5);

        this.debugLog?.('UI-REVEAL', `seg[${String(segmentIndex)}] +${String(charBudget)} allowed (total ${String(card.revealAllowedChars)}/${String(card.totalChars)}), rate=${card.revealRate.toFixed(1)} chars/s`);
        this.ensureRevealTimer();
    }

    private revealTickCount = 0;
    private revealLastTickTime = 0;

    private ensureRevealTimer(): void {
        if (this.revealTimer) return;
        this.revealTickCount = 0;
        this.revealLastTickTime = Date.now();
        const intervalMs = 33; // ~30fps
        this.revealTimer = setInterval(() => {
            this.revealTick();
        }, intervalMs);
        this.debugLog?.('UI-TIMER', 'Reveal timer started');
    }

    private revealTick(): void {
        const now = Date.now();
        const dtSec = (now - this.revealLastTickTime) / 1000;
        this.revealLastTickTime = now;

        let anyActive = false;

        for (const card of this.segmentCards) {
            if (card.finalized) continue;

            // Advance reveal position toward the TTS-allowed budget
            if (card.revealedChars < card.revealAllowedChars) {
                card.revealedChars = Math.min(
                    card.revealedChars + card.revealRate * dtSec,
                    card.revealAllowedChars,
                );

                // Truncate pre-styled chunks and update the TextRenderable
                const truncated = truncateChunks(card.chunks, Math.floor(card.revealedChars));
                card.textNode.content = chunksToStyledText(truncated);
                anyActive = true;
            }

            // Check if fully revealed
            if (card.revealedChars >= card.totalChars) {
                card.finalized = true;
                card.textNode.content = chunksToStyledText(card.chunks);
            }
        }

        // Log every ~1s
        this.revealTickCount++;
        if (this.revealTickCount % 30 === 0) {
            const active = this.segmentCards.filter(c => !c.finalized).length;
            this.debugLog?.('UI-TICK', `${String(active)} active cards, dt=${(dtSec * 1000).toFixed(0)}ms`);
        }

        // Stop timer when all cards are done
        if (!anyActive) {
            this.stopRevealTimer();
        }
    }

    private stopRevealTimer(): void {
        if (this.revealTimer) {
            clearInterval(this.revealTimer);
            this.revealTimer = null;
        }
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    setDebugLog(fn: (label: string, content: string) => void): void {
        this.debugLog = fn;
    }

    onInput(callback: (input: string) => void): void {
        this.inputCallback = callback;
    }

    // ─── Game Over ──────────────────────────────────────────────────────────

    showGameOver(won: boolean): void {
        this.finalizeAllCards();

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

            // UI-local commands (do not send to the game agent).
            if (cmd.name === 'mission') {
                this.dismissPopup();
                this.inputField.value = '';
                this.showMissionModal();
                return;
            }
            if (cmd.name === 'map') {
                this.dismissPopup();
                this.inputField.value = '';
                this.showMapModal();
                return;
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
