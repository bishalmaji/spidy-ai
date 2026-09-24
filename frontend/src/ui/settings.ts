import { SpidyUser, SpidyVoice } from '../types';

export interface SettingsCallbacks {
  onVoiceChange: (voice: SpidyVoice) => void;
  onNewSession: () => void;
  onLogout: () => void;
}

export class SettingsPanel {
  private panel: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private voiceInputs: NodeListOf<HTMLInputElement>;
  private voiceChoice: HTMLElement;
  private newSessionBtn: HTMLButtonElement;
  private loginStateEl: HTMLElement;
  private authSection: HTMLElement;
  private logoutBtn: HTMLButtonElement;
  private loginLink: HTMLButtonElement;
  private open = false;

  constructor(callbacks: SettingsCallbacks) {
    this.panel = document.getElementById('settingsPanel') as HTMLElement;
    this.toggleBtn = document.getElementById('settingsToggle') as HTMLButtonElement;
    this.voiceInputs = document.querySelectorAll<HTMLInputElement>('input[name="spidyVoice"]');
    this.voiceChoice = document.getElementById('voiceChoice') as HTMLElement;
    this.newSessionBtn = document.getElementById('newSessionBtn') as HTMLButtonElement;
    this.loginStateEl = document.getElementById('loginState') as HTMLElement;
    this.authSection = document.getElementById('authSection') as HTMLElement;
    this.logoutBtn = document.getElementById('logoutBtn') as HTMLButtonElement;
    this.loginLink = document.getElementById('loginLink') as HTMLButtonElement;

    this.toggleBtn.addEventListener('click', () => this.toggle());

    this.voiceInputs.forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) callbacks.onVoiceChange(input.value as SpidyVoice);
      });
    });

    this.newSessionBtn.addEventListener('click', () => {
      callbacks.onNewSession();
      this.close();
    });

    this.logoutBtn.addEventListener('click', () => {
      callbacks.onLogout();
      this.close();
    });

    this.loginLink.addEventListener('click', () => {
      this.openPanel();
      const email = document.getElementById('authEmail') as HTMLInputElement | null;
      email?.focus();
    });
  }

  setVoice(voice: SpidyVoice): void {
    this.voiceInputs.forEach((input) => {
      input.checked = input.value === voice;
    });
  }

  setVoiceSwitchable(switchable: boolean): void {
    this.voiceInputs.forEach((input) => {
      input.disabled = !switchable;
    });
  }

  setAuthState(user: SpidyUser | null): void {
    if (user) {
      this.loginStateEl.textContent = user.email;
      this.authSection.hidden = true;
      this.logoutBtn.hidden = false;
      this.loginLink.hidden = true;
      this.voiceChoice.hidden = true;
    } else {
      this.loginStateEl.textContent = 'Guest';
      this.authSection.hidden = false;
      this.logoutBtn.hidden = true;
      this.loginLink.hidden = false;
      this.voiceChoice.hidden = false;
    }
  }

  toggle(): void {
    this.open ? this.close() : this.openPanel();
  }

  openPanel(): void {
    this.open = true;
    this.panel.classList.add('open');
    this.panel.setAttribute('aria-hidden', 'false');
  }

  close(): void {
    this.open = false;
    this.panel.classList.remove('open');
    this.panel.setAttribute('aria-hidden', 'true');
  }
}
