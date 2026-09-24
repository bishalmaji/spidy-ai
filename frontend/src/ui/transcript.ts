export class TranscriptView {
  private userLine: HTMLElement;
  private aiLine: HTMLElement;
  private wrap: HTMLElement;

  constructor() {
    this.wrap = document.getElementById('transcript') as HTMLElement;
    this.userLine = document.getElementById('transcriptUser') as HTMLElement;
    this.aiLine = document.getElementById('transcriptAi') as HTMLElement;
  }

  showUser(text: string): void {
    this.userLine.textContent = text;
    this.userLine.hidden = !text;
    this.wrap.classList.add('visible');
  }

  showAi(text: string): void {
    this.aiLine.textContent = text;
    this.aiLine.hidden = !text;
    this.wrap.classList.add('visible');
  }

  clear(): void {
    this.userLine.textContent = '';
    this.aiLine.textContent = '';
    this.userLine.hidden = true;
    this.aiLine.hidden = true;
    this.wrap.classList.remove('visible');
  }
}
