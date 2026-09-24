import './loadEnv';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import chatRouter from './routes/chat';
import authRouter from './routes/auth';
import { testDatabaseConnection } from './services/db';

const app: Express = express();
const PORT: number = process.env.PORT ? Number(process.env.PORT) : 8080;

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api', authRouter);
app.use('/api', chatRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Listening on http://0.0.0.0:${PORT}`);
  void testDatabaseConnection();
});
