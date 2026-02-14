declare module '@picovoice/pvspeaker-node' {
    export class PvSpeaker {
        constructor(sampleRate: number, bitsPerSample: number, options?: { bufferSizeSecs?: number; deviceIndex?: number });
        readonly sampleRate: number;
        readonly bitsPerSample: number;
        readonly bufferSizeSecs: number;
        readonly version: string;
        readonly isStarted: boolean;
        start(): void;
        stop(): void;
        write(pcm: ArrayBuffer): number;
        flush(): void;
        release(): void;
        getSelectedDevice(): string;
        static getAvailableDevices(): string[];
    }
}
