import { Router, Request, Response } from 'express';
import multer from 'multer';
import { transcribeAudio, getSpidyReply } from '../services/groq';
import { synthesizeSpeech } from '../services/tts';
import { extractName } from '../services/name';
import { getUserByToken, mapGenderToVoice, parseBearerToken } from '../services/users';
import {
  appendMessage,
  createGuestConversation,
  endActiveConversation,
  getOrCreateActiveConversation,
  loadRecentMessages,
} from '../services/conversations';
import {
  detectRepeatedFactsInBackground,
  extractExplicitFact,
  loadUserFacts,
  saveExplicitFact,
} from '../services/facts';
import {
  ChatResponsePayload,
  ConversationMessage,
  SpidyVoice,
  UserRecord,
} from '../types';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router: Router = Router();

const guestVisitConversations = new Map<string, string>();

function parseHistory(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (m): m is ConversationMessage =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    )
    .slice(-16);
}

function parseUserName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed || null;
}

function parseGuestDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed || null;
}

function parseGuestVisitId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 80);
  return trimmed || null;
}

async function guestConversationForVisit(
  guestDeviceId: string,
  guestVisitId: string | null
): Promise<string | null> {
  if (guestVisitId) {
    const cached = guestVisitConversations.get(guestVisitId);
    if (cached) return cached;
  }
  const id = await createGuestConversation(guestDeviceId);
  if (id && guestVisitId) guestVisitConversations.set(guestVisitId, id);
  return id;
}

async function resolveRegisteredUser(req: Request): Promise<UserRecord | null> {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) return null;
  return getUserByToken(token);
}

async function synthesizeSafe(text: string, voice: SpidyVoice): Promise<{ audioBase64: string; audioMimeType: string }> {
  let audioBase64 = '';
  let audioMimeType = 'audio/mpeg';
  try {
    const synthesized = await synthesizeSpeech(text, voice);
    audioBase64 = synthesized.buffer.toString('base64');
    audioMimeType = synthesized.mimeType;
  } catch (error) {
    console.error('[chat] TTS skipped:', error);
  }
  return { audioBase64, audioMimeType };
}

async function runRegisteredTurn(
  user: UserRecord,
  userText: string
): Promise<ChatResponsePayload> {
  const conversationId = await getOrCreateActiveConversation(user.id);
  const history = conversationId ? await loadRecentMessages(conversationId, 16) : [];
  const facts = await loadUserFacts(user.id, 12);
  const voice = mapGenderToVoice(user.gender);

  const explicit = extractExplicitFact(userText);
  if (explicit) {
    void saveExplicitFact(user.id, explicit);
  }

  const aiText = await getSpidyReply(userText, user.nickname, history, false, user.gender, facts);

  if (conversationId) {
    await appendMessage(conversationId, 'user', userText);
    await appendMessage(conversationId, 'assistant', aiText);
  }
  detectRepeatedFactsInBackground(user.id, userText);

  const audio = await synthesizeSafe(aiText, voice);
  return {
    userText,
    aiText,
    audioBase64: audio.audioBase64,
    audioMimeType: audio.audioMimeType,
    extractedName: null,
  };
}

async function runGuestTurn(
  userText: string,
  userName: string | null,
  history: ConversationMessage[],
  needsName: boolean,
  guestDeviceId: string | null,
  guestVisitId: string | null
): Promise<ChatResponsePayload> {
  let extractedName: string | null = null;
  let effectiveName = userName;

  if (needsName) {
    extractedName = extractName(userText);
    if (extractedName) {
      effectiveName = extractedName;
    }
  }

  const aiText: string = await getSpidyReply(userText, effectiveName, history, false, null, []);

  if (guestDeviceId) {
    const conversationId = await guestConversationForVisit(guestDeviceId, guestVisitId);
    if (conversationId) {
      await appendMessage(conversationId, 'user', userText);
      await appendMessage(conversationId, 'assistant', aiText);
    }
  }

  const audio = await synthesizeSafe(aiText, 'female');
  return {
    userText,
    aiText,
    audioBase64: audio.audioBase64,
    audioMimeType: audio.audioMimeType,
    extractedName,
  };
}

router.post('/chat', upload.single('audio'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No audio file was uploaded under the "audio" field.' });
      return;
    }
    if (!req.file.buffer || req.file.buffer.length < 256) {
      res.status(400).json({ error: 'Audio file is empty or too short.' });
      return;
    }

    const userText: string = await transcribeAudio(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const registered = await resolveRegisteredUser(req);
    if (registered) {
      const payload = await runRegisteredTurn(registered, userText);
      res.status(200).json(payload);
      return;
    }

    const userName = parseUserName(req.body?.userName);
    const history = parseHistory(safeJsonParse(req.body?.history));
    const needsName = req.body?.needsName === 'true' || req.body?.needsName === true;
    const guestDeviceId = parseGuestDeviceId(req.body?.guestDeviceId);
    const guestVisitId = parseGuestVisitId(req.body?.guestVisitId);

    const payload = await runGuestTurn(
      userText,
      userName,
      history,
      needsName,
      guestDeviceId,
      guestVisitId
    );
    res.status(200).json(payload);
  } catch (error) {
    console.error('[POST /api/chat] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    res.status(500).json({ error: message });
  }
});

router.post('/chat-text', async (req: Request, res: Response): Promise<void> => {
  try {
    const userText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!userText) {
      res.status(400).json({ error: 'Missing "text" in request body.' });
      return;
    }

    const registered = await resolveRegisteredUser(req);
    if (registered) {
      const payload = await runRegisteredTurn(registered, userText);
      res.status(200).json(payload);
      return;
    }

    const userName = parseUserName(req.body?.userName);
    const history = parseHistory(req.body?.history);
    const needsName = Boolean(req.body?.needsName);
    const guestDeviceId = parseGuestDeviceId(req.body?.guestDeviceId);
    const guestVisitId = parseGuestVisitId(req.body?.guestVisitId);

    const payload = await runGuestTurn(
      userText,
      userName,
      history,
      needsName,
      guestDeviceId,
      guestVisitId
    );
    res.status(200).json(payload);
  } catch (error) {
    console.error('[POST /api/chat-text] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    res.status(500).json({ error: message });
  }
});

router.post('/greet', async (req: Request, res: Response): Promise<void> => {
  try {
    const registered = await resolveRegisteredUser(req);
    if (registered) {
      const voice = mapGenderToVoice(registered.gender);
      const facts = await loadUserFacts(registered.id, 12);
      const aiText = await getSpidyReply(
        '(session just started — greet the user briefly, do not ask their name)',
        registered.nickname,
        [],
        false,
        registered.gender,
        facts
      );
      const audio = await synthesizeSafe(aiText, voice);
      res.status(200).json({ aiText, audioBase64: audio.audioBase64, audioMimeType: audio.audioMimeType });
      return;
    }

    const aiText = await getSpidyReply('(session just started)', null, [], true, null, []);
    const audio = await synthesizeSafe(aiText, 'female');
    res.status(200).json({ aiText, audioBase64: audio.audioBase64, audioMimeType: audio.audioMimeType });
  } catch (error) {
    console.error('[POST /api/greet] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    res.status(500).json({ error: message });
  }
});

router.post('/session/new', async (req: Request, res: Response): Promise<void> => {
  try {
    const registered = await resolveRegisteredUser(req);
    if (!registered) {
      res.status(401).json({ error: 'Registered users only.' });
      return;
    }
    await endActiveConversation(registered.id);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[POST /api/session/new] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    res.status(500).json({ error: message });
  }
});

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export default router;
