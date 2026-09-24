import { LevelCallback } from './recorder';

/**
 * Plays Spidy's TTS response. Interruption here means: stop this audio
 * element dead, right now, and make sure this response can never resume
 * or "come back" later (see `token` guarding in main.ts) — the closest
 * honest equivalent to the Realtime API's response-cancellation semantics
 * that a plain <audio> element can offer.
 */
export class ResponsePlayer {
  private audio: HTMLAudioElement;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private levelRaf: number | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
  }

  private ensureGraph(): void {
    if (this.audioContext) return;
    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
  }

  async play(base64: string, mimeType: string): Promise<void> {
    this.ensureGraph();
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
    this.audio.src = `data:${mimeType};base64,${base64}`;
    await this.audio.play();
  }

  onEnded(callback: () => void): void {
    this.audio.onended = callback;
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.removeAttribute('src');
    this.audio.onended = null;
  }

  get isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended && this.audio.currentTime > 0;
  }

  startLevelMeter(onLevel: LevelCallback): void {
    if (!this.analyser) return;
    const buffer = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = (): void => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(buffer);
      const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length;
      onLevel(Math.min(1, avg / 140));
      this.levelRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  stopLevelMeter(): void {
    if (this.levelRaf !== null) {
      cancelAnimationFrame(this.levelRaf);
      this.levelRaf = null;
    }
  }
}
