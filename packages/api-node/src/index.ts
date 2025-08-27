import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import createError from 'http-errors';
import path from 'path';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*', credentials: true }));

const PORT = parseInt(process.env.PORT || '3001', 10);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:8081';
const PROFILE_SERVICE_URL = process.env.PROFILE_SERVICE_URL || 'http://profile-service:8082';
const POST_SERVICE_URL = process.env.POST_SERVICE_URL || 'http://post-service:8083';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Swagger
const swaggerDocument = YAML.load(path.join(process.cwd(), 'openapi.yaml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Auth proxy
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { data } = await axios.post(`${AUTH_SERVICE_URL}/register`, req.body);
    // create an empty profile for the user so profile-service will return data
    try {
      await axios.put(`${PROFILE_SERVICE_URL}/profiles/${data.id}`, { bio: '', avatarUrl: '' });
    } catch (err) {
      console.warn('create profile fallback failed', String(err));
      // don't fail the registration if profile creation fails
    }
    res.status(201).json(data);
  } catch (err) { next(err); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { data } = await axios.post(`${AUTH_SERVICE_URL}/login`, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

// JWT middleware
function authMiddleware(req: any, _res: any, next: any) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return next(createError(401, 'Missing token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch (_e) {
    return next(createError(401, 'Invalid token'));
  }
}

// Profiles
app.get('/api/profiles/me', authMiddleware, async (req: any, res, next) => {
  try {
    const { data } = await axios.get(`${PROFILE_SERVICE_URL}/profiles/${req.user.id}`);
    res.json(data);
  } catch (err) { next(err); }
});

app.put('/api/profiles/me', authMiddleware, async (req: any, res, next) => {
  try {
    const { data } = await axios.put(`${PROFILE_SERVICE_URL}/profiles/${req.user.id}`, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

// Posts
app.get('/api/posts', async (_req, res, next) => {
  try {
  const feedFor = _req.query.feedFor;
  const url = feedFor ? `${POST_SERVICE_URL}/posts?feedFor=${encodeURIComponent(String(feedFor))}` : `${POST_SERVICE_URL}/posts`;
  const { data } = await axios.get(url);
  res.json(data);
  } catch (err) { next(err); }
});

app.post('/api/posts', authMiddleware, async (req: any, res, next) => {
  try {
    const { data } = await axios.post(`${POST_SERVICE_URL}/posts`, { userId: req.user.id, content: req.body.content });
    res.status(201).json(data);
  } catch (err) { next(err); }
});

app.post('/api/posts/:id/comments', authMiddleware, async (req: any, res, next) => {
  try {
    const { id } = req.params;
    const { data } = await axios.post(`${POST_SERVICE_URL}/posts/${id}/comments`, { userId: req.user.id, content: req.body.content });
    res.status(201).json(data);
  } catch (err) { next(err); }
});

app.get('/api/notifications/:id', authMiddleware, async (req: any, res, next) => {
  try {
    const { data } = await axios.get(`${POST_SERVICE_URL}/notifications/${req.params.id}`);
    res.json(data);
  } catch (err) { next(err); }
});

app.post('/api/notifications/:id/read', authMiddleware, async (req: any, res, next) => {
  try {
    await axios.post(`${POST_SERVICE_URL}/notifications/${req.params.id}/read`);
    res.status(204).end();
  } catch (err) { next(err); }
});

// follow/unfollow
app.post('/api/profiles/:id/follow', async (req, res, next) => {
  try {
    const { data } = await axios.post(`${PROFILE_SERVICE_URL}/profiles/${req.params.id}/follow`, { followerId: req.body.followerId });
    res.status(204).end();
  } catch (err) { next(err); }
});
app.post('/api/profiles/:id/unfollow', async (req, res, next) => {
  try {
    const { data } = await axios.post(`${PROFILE_SERVICE_URL}/profiles/${req.params.id}/unfollow`, { followerId: req.body.followerId });
    res.status(204).end();
  } catch (err) { next(err); }
});
app.get('/api/profiles/:id/following', async (req, res, next) => {
  try {
    const { data } = await axios.get(`${PROFILE_SERVICE_URL}/profiles/${req.params.id}/following`);
    res.json(data);
  } catch (err) { next(err); }
});

app.post('/api/posts/:id/like', authMiddleware, async (req: any, res, next) => {
  try {
    const { id } = req.params;
    const { data } = await axios.post(`${POST_SERVICE_URL}/posts/${id}/like`, { userId: req.user.id });
    res.json(data);
  } catch (err) { next(err); }
});

// Users search
app.get('/api/users', async (req, res, next) => {
  try {
    const q = req.query.query || '';
    const { data } = await axios.get(`${AUTH_SERVICE_URL}/users?query=${encodeURIComponent(String(q))}`);
    res.json(data);
  } catch (err) { next(err); }
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: any, res: any, _next: any) => {
  const status = err.response?.status || err.status || 500;
  const message = err.response?.data || err.message || 'Internal error';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`API Gateway listening on :${PORT}`);
});
