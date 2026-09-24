export type LevelCallback = (level: number) => void;

/**
 * Wraps getUserMedia + MediaRecorder for a single tap-to-talk turn.
 * The stream and AudioContext are created once and reused across turns
 * (see main.ts) rather than being torn down and recreated every time.
 */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private levelRaf: number | null = null;

  async ensurePermission(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
  }

  get hasPermission(): boolean {
    return this.stream !== null;
  }

  startLevelMeter(onLevel: LevelCallback): void {
    if (!this.analyser) return;
    const buffer = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = (): void => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (const value of buffer) {
        const normalized = (value - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      onLevel(Math.min(1, rms * 4));
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

  startRecording(): void {
    if (!this.stream) throw new Error('Microphone permission not granted yet.');
    this.chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error('Not currently recording.'));
        return;
      }
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
        resolve(blob);
      };
      this.recorder.stop();
    });
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }
}
