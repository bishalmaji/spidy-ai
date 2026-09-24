import { AppVoiceState } from '../types';

const STATE_COLOR: Record<AppVoiceState, string> = {
  initializing: '148, 148, 158',
  permission_required: '148, 148, 158',
  connecting: '148, 148, 158',
  idle: '120, 130, 220',
  listening: '90, 200, 230',
  thinking: '190, 130, 240',
  speaking: '235, 70, 90',
  error: '200, 90, 90',
};

export class VoiceOrb {
  private ctx: CanvasRenderingContext2D;
  private raf: number | null = null;
  private level = 0;
  private state: AppVoiceState = 'initializing';
  private pulsePhase = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    this.ctx = ctx;
    this.loop();
  }

  setState(state: AppVoiceState): void {
    this.state = state;
  }

  setLevel(level: number): void {
    this.level = level;
  }

  private loop = (): void => {
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    this.pulsePhase += 0.02;
    const idlePulse = 0.5 + Math.sin(this.pulsePhase) * 0.5;
    const isActive = this.state === 'listening' || this.state === 'speaking';
    const energy = isActive ? this.level : idlePulse * 0.25;

    const baseRadius = w * 0.28;
    const color = STATE_COLOR[this.state];

    // Outer glow rings, scale with energy.
    for (let i = 3; i >= 1; i--) {
      const radius = baseRadius + i * (10 + energy * 26);
      const alpha = (0.09 / i) * (0.6 + energy);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color}, ${alpha.toFixed(3)})`;
      ctx.fill();
    }

    // Core orb with radial gradient.
    const coreRadius = baseRadius * (1 + energy * 0.18);
    const gradient = ctx.createRadialGradient(
      cx - coreRadius * 0.3,
      cy - coreRadius * 0.3,
      coreRadius * 0.1,
      cx,
      cy,
      coreRadius
    );
    gradient.addColorStop(0, `rgba(${color}, 0.95)`);
    gradient.addColorStop(1, `rgba(${color}, 0.35)`);
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    if (this.state === 'thinking') {
      // Subtle rotating arc to suggest "processing" without being literal.
      const arcRadius = coreRadius + 14;
      ctx.beginPath();
      ctx.arc(cx, cy, arcRadius, this.pulsePhase, this.pulsePhase + Math.PI * 0.6);
      ctx.strokeStyle = `rgba(${color}, 0.6)`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
