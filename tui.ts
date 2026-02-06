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

export interface SlashCommandDef {
    name: string;
    description: string;
    needsTarget: boolean;
    getTargets: () => { label: string; value: string }[];
    toPrompt: (target?: string) => string;
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
        this.renderer.root.add(this.popupBox);
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

    showAttackChoices(approaches: { label: string; description: string }[]): void {
        this.dismissInlineChoices();

        const select = new SelectRenderable(this.renderer, {
            id: `choices-${String(Date.now())}`,
            options: approaches.map((a, i) => ({
                name: `${String(i + 1)}. ${a.label}`,
                description: a.description,
                value: a.label,
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
            id: `choices-hint-${String(Date.now())}`,
            content: t`${fg(COLORS.textDim)('  ↑↓ Navigate  Enter Select  Or type your own approach')}`,
        });

        // Each option with description ~2 lines + hint + padding + border
        const cardHeight = approaches.length * 2 + 4;

        const card = new BoxRenderable(this.renderer, {
            id: `choices-card-${String(Date.now())}`,
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
                .filter(t => t.label.toLowerCase().startsWith(typed))
                .map(t => ({ name: t.label, description: '', value: t.value }));

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
                    this.popupHint.content = t`${fg(COLORS.title)(`/ ${cmd.name} → target`)}`;
                    this.popupSelect.options = targets.map(t => ({
                        name: t.label, description: '', value: t.value,
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

    destroy(): void {
        this.renderer.destroy();
    }
}
