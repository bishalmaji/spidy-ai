import './style.css';
import { fetchGreeting, fetchMe, logoutAuth, sendVoiceTurn, startNewServerSession } from './api/spidyApi';
import { AuthGate } from './ui/authGate';
import {
  clearAuthToken,
  getGuestDeviceId,
  getGuestVisitId,
  loadAuthToken,
} from './session/authStore';
import {
  appendTurn,
  loadGuestSession,
  loadRegisteredSession,
  loadVoicePreference,
  saveVoicePreference,
  setName,
  startNewSession,
} from './session/sessionStore';
import { SpidySession, SpidyUser, SpidyVoice, UserGender } from './types';
import { isNewSessionCommand } from './voice/commands';
import { MicRecorder } from './voice/recorder';
import { ResponsePlayer } from './voice/player';
import { STATUS_LABEL, VoiceStateMachine } from './voice/voiceState';
import { VoiceOrb } from './ui/orb';
import { SettingsPanel } from './ui/settings';
import { TranscriptView } from './ui/transcript';

const orbCanvas = document.getElementById('orbCanvas') as HTMLCanvasElement;
const orbButton = document.getElementById('orbButton') as HTMLButtonElement;
const statusEl = document.getElementById('statusText') as HTMLElement;
const startOverlay = document.getElementById('startOverlay') as HTMLElement;
const startBtn = document.getElementById('startVoiceBtn') as HTMLButtonElement;
const fallbackForm = document.getElementById('fallbackForm') as HTMLFormElement;
const fallbackInput = document.getElementById('fallbackInput') as HTMLInputElement;
const fallbackToggle = document.getElementById('fallbackToggle') as HTMLButtonElement;

const recorder = new MicRecorder();
const player = new ResponsePlayer();
const orb = new VoiceOrb(orbCanvas);
const stateMachine = new VoiceStateMachine();
const transcript = new TranscriptView();
const guestDeviceId = getGuestDeviceId();
const guestVisitId = getGuestVisitId();

let currentUser: SpidyUser | null = null;
let session: SpidySession = loadGuestSession();
let voice: SpidyVoice = loadVoicePreference();
let turnToken = 0;

const SILENCE_DURATION_MS = 2000;
const SPEECH_THRESHOLD = 0.08;

let silenceTimer: number | null = null;
let hasDetectedSpeech = false;

function mapGenderToVoice(gender: UserGender): SpidyVoice {
  return gender === 'male' ? 'female' : 'male';
}

function isRegistered(): boolean {
  return currentUser !== null;
}

const settings = new SettingsPanel({
  onVoiceChange: (nextVoice) => {
    if (isRegistered()) return;
    voice = nextVoice;
    saveVoicePreference(voice);
  },
  onNewSession: () => {
    void handleNewSession();
  },
  onLogout: () => {
    void handleLogout();
  },
});
settings.setVoice(voice);
settings.setAuthState(null);

const authGate = new AuthGate({
  onLoggedIn: (user) => {
    handleInterrupt();
    enterRegisteredMode(user);
    void bootstrap({ forceGreeting: false });
  },
});

stateMachine.subscribe((state) => {
  statusEl.textContent = STATUS_LABEL[state];
  orb.setState(state);
  orbButton.setAttribute('aria-label', STATUS_LABEL[state]);
  settings.setVoiceSwitchable(state === 'idle' || state === 'error');
});

// function setLevel(level: number): void {
//   orb.setLevel(level);
// }

function clearSilenceTimer(): void {
  if (silenceTimer !== null) {
    window.clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

function setLevel(level: number): void {
  orb.setLevel(level);

  // Silence detection only applies while the user is recording.
  if (stateMachine.current !== 'listening') {
    return;
  }

  // User is speaking.
  if (level >= SPEECH_THRESHOLD) {
    hasDetectedSpeech = true;
    clearSilenceTimer();
    return;
  }

  // Ignore silence before the user has actually started speaking.
  // This prevents a simple tap from sending an empty recording after 2 sec.
  if (!hasDetectedSpeech || silenceTimer !== null) {
    return;
  }

  silenceTimer = window.setTimeout(() => {
    silenceTimer = null;

    // Make sure we're still in a listening state.
    if (stateMachine.current === 'listening' && hasDetectedSpeech) {
      void stopListeningAndSend();
    }
  }, SILENCE_DURATION_MS);
}

function enterRegisteredMode(user: SpidyUser): void {
  currentUser = user;
  voice = mapGenderToVoice(user.gender);
  session = loadRegisteredSession(user.nickname);
  transcript.clear();
  settings.setAuthState(user);
  settings.setVoice(voice);
  authGate.reset();
}

function enterGuestMode(): void {
  currentUser = null;
  voice = loadVoicePreference();
  session = loadGuestSession();
  transcript.clear();
  settings.setAuthState(null);
  settings.setVoice(voice);
  authGate.reset();
}

async function handleNewSession(): Promise<void> {
  handleInterrupt();
  transcript.clear();
  if (isRegistered() && currentUser) {
    try {
      await startNewServerSession();
    } catch (error) {
      console.error('[session] Failed to end server conversation:', error);
    }
    session = startNewSession(currentUser.nickname, false);
    stateMachine.set('idle');
    return;
  }
  session = startNewSession(null, true);
  void speakGreeting();
}

async function handleLogout(): Promise<void> {
  handleInterrupt();
  const token = loadAuthToken();
  if (token) {
    try {
      await logoutAuth(token);
    } catch (error) {
      console.error('[auth] Logout request failed:', error);
    }
  }
  clearAuthToken();
  enterGuestMode();
  void bootstrap({ forceGreeting: true });
}

async function ensureMic(): Promise<boolean> {
  if (recorder.hasPermission) return true;
  try {
    stateMachine.set('connecting');
    await recorder.ensurePermission();
    return true;
  } catch (error) {
    console.error('[mic] Permission denied or unavailable:', error);
    stateMachine.set('permission_required');
    startOverlay.hidden = false;
    return false;
  }
}

async function speakGreeting(): Promise<void> {
  const myToken = ++turnToken;
  stateMachine.set('thinking');
  try {
    const greet = await fetchGreeting(voice);
    if (myToken !== turnToken) return;
    transcript.showAi(greet.aiText);
    await playResponse(greet.audioBase64, greet.audioMimeType, myToken);
  } catch (error) {
    console.error('[greet] Failed:', error);
    if (myToken !== turnToken) return;
    stateMachine.set('error');
  }
}

async function playResponse(base64: string, mimeType: string, myToken: number): Promise<void> {
  if (!base64) {
    if (myToken === turnToken) stateMachine.set('idle');
    return;
  }
  stateMachine.set('speaking');
  player.startLevelMeter(setLevel);
  player.onEnded(() => {
    if (myToken !== turnToken) return;
    player.stopLevelMeter();
    setLevel(0);
    stateMachine.set('idle');
  });
  try {
    await player.play(base64, mimeType);
  } catch (error) {
    console.error('[player] Playback failed:', error);
    if (myToken === turnToken) stateMachine.set('idle');
  }
}

function handleInterrupt(): void {
  if (player.isPlaying) {
    turnToken++;
    player.stop();
    player.stopLevelMeter();
    setLevel(0);
    stateMachine.set('idle');
  }
}

// async function startListening(): Promise<void> {
//   const ok = await ensureMic();
//   if (!ok) return;
//   transcript.clear();
//   recorder.startRecording();
//   recorder.startLevelMeter(setLevel);
//   stateMachine.set('listening');
// }

async function startListening(): Promise<void> {
  const ok = await ensureMic();
  if (!ok) return;

  clearSilenceTimer();
  hasDetectedSpeech = false;

  transcript.clear();
  recorder.startRecording();
  recorder.startLevelMeter(setLevel);
  stateMachine.set('listening');
}

async function applyTurnResponse(
  response: {
    userText: string;
    aiText: string;
    audioBase64: string;
    audioMimeType: string;
    extractedName: string | null;
  },
  myToken: number
): Promise<void> {
  transcript.showUser(response.userText);
  transcript.showAi(response.aiText);

  if (isNewSessionCommand(response.userText)) {
    await handleNewSession();
    return;
  }

  if (!isRegistered() && session.needsName && response.extractedName) {
    session = setName(session, response.extractedName);
  }
  session = appendTurn(session, response.userText, response.aiText, !isRegistered());
  await playResponse(response.audioBase64, response.audioMimeType, myToken);
}

// async function stopListeningAndSend(): Promise<void> {
//   recorder.stopLevelMeter();
async function stopListeningAndSend(): Promise<void> {
  clearSilenceTimer();
  hasDetectedSpeech = false;

  recorder.stopLevelMeter();
  setLevel(0);
  const myToken = ++turnToken;
  stateMachine.set('thinking');
  try {
    const audioBlob = await recorder.stopRecording();
    if (audioBlob.size < 800) {
      if (myToken === turnToken) stateMachine.set('idle');
      return;
    }

    const response = await sendVoiceTurn({
      audioBlob,
      userName: session.userName,
      needsName: isRegistered() ? false : session.needsName,
      history: isRegistered() ? [] : session.conversation,
      voice,
      guestDeviceId,
      guestVisitId,
      registered: isRegistered(),
    });
    if (myToken !== turnToken) return;
    await applyTurnResponse(response, myToken);
  } catch (error) {
    console.error('[turn] Failed:', error);
    if (myToken === turnToken) stateMachine.set('error');
  }
}

orbButton.addEventListener('click', () => {
  const state = stateMachine.current;
  if (state === 'permission_required' || state === 'initializing') {
    void bootstrap();
    return;
  }
  if (state === 'speaking') {
    handleInterrupt();
    return;
  }
  if (state === 'idle' || state === 'error') {
    void startListening();
    return;
  }
  if (state === 'listening') {
    void stopListeningAndSend();
    return;
  }
});

startBtn.addEventListener('click', () => {
  startOverlay.hidden = true;
  void bootstrap();
});

fallbackToggle.addEventListener('click', () => {
  fallbackForm.hidden = !fallbackForm.hidden;
  if (!fallbackForm.hidden) fallbackInput.focus();
});

fallbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = fallbackInput.value.trim();
  if (!text) return;
  fallbackInput.value = '';
  const myToken = ++turnToken;
  stateMachine.set('thinking');
  transcript.showUser(text);
  try {
    const { sendTextTurn } = await import('./api/textFallback');
    const response = await sendTextTurn({
      text,
      userName: session.userName,
      needsName: isRegistered() ? false : session.needsName,
      history: isRegistered() ? [] : session.conversation,
      voice,
      guestDeviceId,
      guestVisitId,
      registered: isRegistered(),
    });
    if (myToken !== turnToken) return;
    await applyTurnResponse(response, myToken);
  } catch (error) {
    console.error('[fallback] Failed:', error);
    if (myToken === turnToken) stateMachine.set('error');
  }
});

async function bootstrap(opts: { forceGreeting?: boolean } = {}): Promise<void> {
  const ok = await ensureMic();
  if (!ok) return;
  startOverlay.hidden = true;

  if (isRegistered()) {
    stateMachine.set('idle');
    return;
  }

  if (opts.forceGreeting || (session.needsName && session.conversation.length === 0)) {
    await speakGreeting();
    return;
  }
  stateMachine.set('idle');
}

async function init(): Promise<void> {
  const token = loadAuthToken();
  if (token) {
    try {
      const user = await fetchMe();
      if (user) {
        enterRegisteredMode(user);
        void bootstrap();
        return;
      }
    } catch (error) {
      console.error('[auth] Token check failed:', error);
    }
    clearAuthToken();
  }
  enterGuestMode();
  void bootstrap();
}

void init();
