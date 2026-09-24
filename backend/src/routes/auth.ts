import { Router, Request, Response } from 'express';
import {
  findOrCreateUser,
  getUserByToken,
  issueAuthToken,
  parseBearerToken,
  revokeToken,
} from '../services/users';
import { UserGender } from '../types';

const router: Router = Router();

function parseGender(value: unknown): UserGender | undefined {
  if (value === 'male' || value === 'female' || value === 'neutral') return value;
  return undefined;
}

function dbDownMessage(): string {
  return 'Account services are temporarily unavailable. You can keep chatting as a guest.';
}

router.post('/auth/continue', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    if (!email.trim()) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname : undefined;
    const gender = parseGender(req.body?.gender);

    const result = await findOrCreateUser(email, nickname, gender);
    if (!result) {
      res.status(503).json({ error: dbDownMessage() });
      return;
    }

    if (!result.exists) {
      res.status(200).json({ status: 'new', email: email.trim().toLowerCase() });
      return;
    }

    const token = await issueAuthToken(result.user.id);
    if (!token) {
      res.status(503).json({ error: dbDownMessage() });
      return;
    }

    res.status(200).json({ status: 'ok', token, user: result.user });
  } catch (error) {
    console.error('[POST /api/auth/continue] Error:', error);
    res.status(500).json({ error: 'Could not continue with that email. Please try again.' });
  }
});

router.post('/auth/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: 'Token is required.' });
      return;
    }
    await revokeToken(token);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[POST /api/auth/logout] Error:', error);
    res.status(500).json({ error: 'Could not log out. Please try again.' });
  }
});

router.get('/auth/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'Missing token.' });
      return;
    }
    const user = await getUserByToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid token.' });
      return;
    }
    res.status(200).json({ user });
  } catch (error) {
    console.error('[GET /api/auth/me] Error:', error);
    res.status(401).json({ error: 'Not authenticated.' });
  }
});

export default router;
