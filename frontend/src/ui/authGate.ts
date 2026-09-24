import { continueAuth } from '../api/spidyApi';
import { saveAuthToken } from '../session/authStore';
import { SpidyUser, UserGender } from '../types';

export interface AuthGateCallbacks {
  onLoggedIn: (user: SpidyUser) => void;
}

export class AuthGate {
  private form: HTMLFormElement;
  private emailInput: HTMLInputElement;
  private extraFields: HTMLElement;
  private nicknameInput: HTMLInputElement;
  private errorEl: HTMLElement;
  private submitBtn: HTMLButtonElement;
  private pendingEmail = '';

  constructor(private callbacks: AuthGateCallbacks) {
    this.form = document.getElementById('authForm') as HTMLFormElement;
    this.emailInput = document.getElementById('authEmail') as HTMLInputElement;
    this.extraFields = document.getElementById('authExtraFields') as HTMLElement;
    this.nicknameInput = document.getElementById('authNickname') as HTMLInputElement;
    this.errorEl = document.getElementById('authError') as HTMLElement;
    this.submitBtn = document.getElementById('authSubmit') as HTMLButtonElement;

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleSubmit();
    });
  }

  reset(): void {
    this.pendingEmail = '';
    this.emailInput.value = '';
    this.nicknameInput.value = '';
    this.extraFields.hidden = true;
    this.errorEl.hidden = true;
    this.errorEl.textContent = '';
    this.submitBtn.textContent = 'Continue';
    this.submitBtn.disabled = false;
  }

  private selectedGender(): UserGender | null {
    const checked = this.form.querySelector<HTMLInputElement>('input[name="authGender"]:checked');
    const value = checked?.value;
    if (value === 'male' || value === 'female' || value === 'neutral') return value;
    return null;
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
  }

  private async handleSubmit(): Promise<void> {
    const email = this.emailInput.value.trim();
    if (!email) {
      this.showError('Enter an email to continue.');
      return;
    }

    this.errorEl.hidden = true;
    this.submitBtn.disabled = true;

    try {
      if (this.extraFields.hidden) {
        const result = await continueAuth({ email });
        if (result.status === 'new') {
          this.pendingEmail = result.email;
          this.extraFields.hidden = false;
          this.submitBtn.textContent = 'Create account';
          this.nicknameInput.focus();
          return;
        }
        saveAuthToken(result.token);
        this.callbacks.onLoggedIn(result.user);
        return;
      }

      const nickname = this.nicknameInput.value.trim();
      const gender = this.selectedGender();
      if (!nickname || !gender) {
        this.showError('Nickname and gender are required for a new account.');
        return;
      }

      const result = await continueAuth({
        email: this.pendingEmail || email,
        nickname,
        gender,
      });
      if (result.status === 'new') {
        this.showError('Could not create the account. Try again.');
        return;
      }
      saveAuthToken(result.token);
      this.callbacks.onLoggedIn(result.user);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed.';
      this.showError(message);
    } finally {
      this.submitBtn.disabled = false;
    }
  }
}
