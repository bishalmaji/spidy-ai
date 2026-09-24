import { AppVoiceState } from '../types';

type Listener = (state: AppVoiceState) => void;

export class VoiceStateMachine {
  private state: AppVoiceState = 'initializing';
  private listeners: Listener[] = [];

  get current(): AppVoiceState {
    return this.state;
  }

  set(next: AppVoiceState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
export const STATUS_LABEL: Record<AppVoiceState, string> = {
  initializing: 'Just getting ready…',
  permission_required: 'माइक के लिए एक बार टैप करो',
  connecting: 'एक सेकंड, Connecting…',
  idle: 'शुरू करें? बोलो…',
  listening: 'हाँ, बोलो…',
  thinking: 'Hmm...Thinking',
  speaking: '.......',
  error: 'कुछ गड़बड़ हो गई — Recharge kro jaldi..',
};
