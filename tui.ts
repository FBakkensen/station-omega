import {
    createCliRenderer,
    Box,
    Text,
    InputRenderableEvents,
    TextRenderable,
    MarkdownRenderable,
    BoxRenderable,
    ScrollBoxRenderable,
    InputRenderable,
    SyntaxStyle,
    RGBA,
    t,
    bold,
    fg,
    bg,
    DistortionEffect,
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
    cardBg: '#243348',
    cmdCardBg: '#1e2a3a',
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NPCDisplayInfo {
    name: string;
    disposition: 'hostile' | 'neutral' | 'friendly' | 'dead';
    hpPct: number;
    currentHp: number;
    maxHp: number;
}

export interface GameStatus {
    hp: number;
    maxHp: number;
    roomName: string;
    roomNumber: number;
    totalRooms: number;
    inventory: string[];
    npcs: NPCDisplayInfo[];
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
            // NPC contacts bar
            Box(
                {
                    height: 1,
                    width: '100%',
                    flexDirection: 'row',
                    backgroundColor: COLORS.panelBg,
                    paddingLeft: 1,
                    paddingRight: 1,
                },
                this.npcText,
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
            content: text,
            syntaxStyle: mdTheme,
            streaming: false,
        });
        this.addCard(md, COLORS.cardBg);
    }

    appendNarrativeDelta(delta: string): void {
        this.currentDelta += delta;
        if (!this.currentDeltaMd) {
            this.currentDeltaMd = new MarkdownRenderable(this.renderer, {
                id: `delta-${String(Date.now())}`,
                content: this.currentDelta,
                syntaxStyle: mdTheme,
                streaming: true,
            });
            this.addCard(this.currentDeltaMd, COLORS.cardBg);
        } else {
            this.currentDeltaMd.content = this.currentDelta;
        }
    }

    finalizeDelta(): void {
        if (this.currentDeltaMd) {
            this.currentDeltaMd.streaming = false;
            this.currentDeltaMd.content = this.currentDelta;
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

    enableCombatGlitch(): void {
        this.renderer.addPostProcessFn(this.distortionFn);
    }

    disableCombatGlitch(): void {
        this.renderer.removePostProcessFn(this.distortionFn);
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

        // Update NPC contacts bar — name with HP background, icon-only disposition
        if (status.npcs.length === 0) {
            this.npcText.content = t`${fg(COLORS.textDim)('Contacts: none')}`;
        } else {
            const npc = status.npcs[0];
            const icon = npc.disposition === 'hostile' ? '!'
                : npc.disposition === 'friendly' ? '*'
                : '?';
            const hpColor = npc.hpPct >= 0.6 ? '#1a5c2a' : npc.hpPct >= 0.25 ? '#5c4a0a' : '#5c1a1a';
            const emptyColor = '#1a1a2a';
            const padded = ` ${npc.name} `;
            const split = Math.round(npc.hpPct * padded.length);
            const filledPart = padded.slice(0, split);
            const emptyPart = padded.slice(split);

            this.npcText.content = t`${fg(COLORS.textDim)(icon)} ${bg(hpColor)(fg('#ffffff')(filledPart))}${bg(emptyColor)(fg(COLORS.textDim)(emptyPart))}`;
        }
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
