import {
    createCliRenderer,
    Box,
    Text,
    InputRenderableEvents,
    TextRenderable,
    ScrollBoxRenderable,
    InputRenderable,
    t,
    bold,
    fg,
    stringToStyledText,
} from '@opentui/core';
import type { CliRenderer } from '@opentui/core';

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
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GameStatus {
    hp: number;
    maxHp: number;
    roomName: string;
    roomNumber: number;
    totalRooms: number;
    inventory: string[];
}

// ─── GameUI ──────────────────────────────────────────────────────────────────

export class GameUI {
    private renderer!: CliRenderer;
    private narrativeScroll!: ScrollBoxRenderable;
    private statusText!: TextRenderable;
    private inputField!: InputRenderable;
    private currentDelta = '';
    private currentDeltaText: TextRenderable | null = null;
    private inputCallback: ((input: string) => void) | null = null;
    private inputEnabled = true;

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
                paddingLeft: 1,
                paddingRight: 1,
                paddingTop: 1,
                gap: 0,
            },
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
            this.inputField.value = '';
            if (this.inputCallback) {
                this.inputCallback(trimmed);
            }
        });

        // Build layout
        const layout = Box(
            {
                flexDirection: 'column',
                width: '100%',
                height: '100%',
                backgroundColor: COLORS.bg,
            },
            // Main narrative panel
            Box(
                {
                    flexGrow: 1,
                    flexDirection: 'column',
                    borderStyle: 'rounded',
                    borderColor: COLORS.border,
                    title: ' 🚀 STATION OMEGA ',
                    titleAlignment: 'center',
                    backgroundColor: COLORS.panelBg,
                },
                this.narrativeScroll,
            ),
            // Status bar
            Box(
                {
                    height: 1,
                    width: '100%',
                    flexDirection: 'row',
                    backgroundColor: COLORS.border,
                    paddingLeft: 1,
                    paddingRight: 1,
                },
                this.statusText,
            ),
            // Input area
            Box(
                {
                    height: 1,
                    width: '100%',
                    flexDirection: 'row',
                    paddingLeft: 1,
                },
                Text({ content: t`${fg(COLORS.title)('❯')} ` }),
                this.inputField,
            ),
        );

        this.renderer.root.add(layout);
        this.inputField.focus();
    }

    appendNarrative(text: string): void {
        const textNode = new TextRenderable(this.renderer, {
            id: `narrative-${String(Date.now())}`,
            content: text,
            fg: COLORS.narrative,
        });
        this.narrativeScroll.add(textNode);
    }

    appendNarrativeDelta(delta: string): void {
        this.currentDelta += delta;
        if (!this.currentDeltaText) {
            this.currentDeltaText = new TextRenderable(this.renderer, {
                id: `delta-${String(Date.now())}`,
                content: this.currentDelta,
                fg: COLORS.narrative,
            });
            this.narrativeScroll.add(this.currentDeltaText);
        } else {
            this.currentDeltaText.content = stringToStyledText(this.currentDelta);
        }
    }

    finalizeDelta(): void {
        if (this.currentDelta) {
            this.narrativeScroll.add(new TextRenderable(this.renderer, {
                id: `sep-${String(Date.now())}`,
                content: ' ',
            }));
        }
        this.currentDelta = '';
        this.currentDeltaText = null;
    }

    updateStatus(status: GameStatus): void {
        const hpPct = status.hp / status.maxHp;
        const hpColor = hpPct >= 0.6 ? COLORS.hpGood : hpPct >= 0.25 ? COLORS.hpMid : COLORS.hpLow;
        const hpLabel = hpPct >= 0.8 ? 'Healthy'
            : hpPct >= 0.5 ? 'Wounded'
            : hpPct >= 0.25 ? 'Critical'
            : 'Dying';

        const inv = status.inventory.length > 0 ? status.inventory.join(', ') : 'empty';

        this.statusText.content = t`${fg(hpColor)(`♥ ${hpLabel}`)}  ${fg(COLORS.textDim)('│')}  ${fg(COLORS.text)(status.roomName)} ${fg(COLORS.textDim)(`(${String(status.roomNumber)}/${String(status.totalRooms)})`)}  ${fg(COLORS.textDim)('│')}  ${fg(COLORS.text)(`Inv: ${inv}`)}`;
    }

    onInput(callback: (input: string) => void): void {
        this.inputCallback = callback;
    }

    disableInput(): void {
        this.inputEnabled = false;
    }

    showGameOver(won: boolean): void {
        this.disableInput();
        this.finalizeDelta();

        const message = won
            ? t`${bold(fg('#00ff88')('🏆 MISSION COMPLETE'))}${fg(COLORS.textDim)(' — Thanks for playing Station Omega!')}`
            : t`${bold(fg('#ff4444')('💀 GAME OVER'))}${fg(COLORS.textDim)(' — You died on Station Omega. Better luck next time.')}`;

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
            content: t`${fg(COLORS.textDim)('Press Ctrl+C to exit.')}`,
        }));
    }

    destroy(): void {
        this.renderer.destroy();
    }
}
