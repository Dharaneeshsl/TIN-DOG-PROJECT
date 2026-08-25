require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Database = require('better-sqlite3');
const { z } = require('zod');
const nodemailer = require('nodemailer');

const app = express();
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'tindog.sqlite');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const CLIENT_DIST = path.join(__dirname, 'dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');
const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase();
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA === 'true';
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const EMAIL_FROM = process.env.EMAIL_FROM || 'TIN-DOG <no-reply@tindog.local>';
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
const mailer = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }) : null;

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'development-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(DATABASE_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_years INTEGER NOT NULL CHECK (age_years >= 0 AND age_years <= 30),
  breed TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  interests_json TEXT NOT NULL DEFAULT '[]',
  vaccinated INTEGER NOT NULL DEFAULT 0,
  neutered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS swipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('like', 'pass', 'super')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, dog_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unmatched')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_a_id, user_b_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('month', 'year', 'one_time')),
  features_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  provider TEXT NOT NULL,
  provider_order_id TEXT,
  provider_payment_id TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  provider TEXT NOT NULL,
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, event_id)
);
CREATE TABLE IF NOT EXISTS email_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_swipes_user ON swipes(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_users ON matches(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
`;
db.exec(schema);
const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
if (userTableSql && !userTableSql.includes('email_verified')) db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
const orderTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get()?.sql || '';
if (orderTableSql && !orderTableSql.includes('provider_subscription_id')) db.exec('ALTER TABLE orders ADD COLUMN provider_subscription_id TEXT');
if (ADMIN_EMAILS.size) db.prepare(`UPDATE users SET role = 'admin' WHERE lower(email) IN (${Array.from(ADMIN_EMAILS, () => '?').join(',')})`).run(...ADMIN_EMAILS);

// Upgrade databases created before super likes were introduced.
const swipeTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'swipes'").get()?.sql || '';
if (swipeTableSql && !swipeTableSql.includes("'super'")) {
  db.transaction(() => {
    db.exec(`ALTER TABLE swipes RENAME TO swipes_legacy;
      CREATE TABLE swipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dog_id INTEGER NOT NULL REFERENCES dogs(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('like', 'pass', 'super')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, dog_id)
      );
      INSERT INTO swipes (id, user_id, dog_id, action, created_at) SELECT id, user_id, dog_id, action, created_at FROM swipes_legacy;
      DROP TABLE swipes_legacy;
      CREATE INDEX IF NOT EXISTS idx_swipes_user ON swipes(user_id);`);
  })();
}

const planSeed = [
  ['free', 'Puppy', 'A friendly start for discovering the community.', 0, CURRENCY, 'month', ['5 daily likes', 'Basic profile', 'Match messaging']],
  ['plus', 'Adult Dog', 'More visibility and unlimited discovery.', 999, CURRENCY, 'month', ['Unlimited likes', 'Advanced filters', 'Priority discovery', 'Unlimited messaging']],
  ['premium', 'Senior Dog', 'The complete premium experience.', 1999, CURRENCY, 'month', ['Everything in Plus', 'Profile boost', 'VIP support', 'Read receipts']]
];
const insertPlan = db.prepare(`INSERT OR IGNORE INTO plans (id, name, description, price_cents, currency, interval, features_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
for (const [id, name, description, price, currency, interval, features] of planSeed) {
  insertPlan.run(id, name, description, price, currency, interval, JSON.stringify(features));
}

const demoDogs = [
  { owner: 'Maya', email: 'maya.demo@tindog.local', name: 'Luna', age: 2, breed: 'Siberian Husky', bio: 'Adventure seeker, snow lover, and always ready for a long walk.', image: '/assets/luna.jpg', location: 'Seattle, WA', interests: ['hiking', 'snow', 'running'], vaccinated: true, neutered: false },
  { owner: 'Jordan', email: 'jordan.demo@tindog.local', name: 'Max', age: 4, breed: 'German Shepherd', bio: 'Protective, loyal, and happiest when learning a new trick.', image: '/assets/max.jpg', location: 'Los Angeles, CA', interests: ['training', 'parks', 'loyalty'], vaccinated: true, neutered: true },
  { owner: 'Priya', email: 'priya.demo@tindog.local', name: 'Bella', age: 1, breed: 'Corgi', bio: 'Small but mighty. Professional cuddler and treat enthusiast.', image: '/assets/bella.jpg', location: 'Austin, TX', interests: ['cuddles', 'treats', 'play'], vaccinated: true, neutered: false },
  { owner: 'Ethan', email: 'ethan.demo@tindog.local', name: 'Rocky', age: 5, breed: 'Boxer', bio: 'Energetic, playful, and never says no to a game of fetch.', image: '/assets/rocky.jpg', location: 'Miami, FL', interests: ['energy', 'play', 'fetch'], vaccinated: true, neutered: true },
  { owner: 'Sofia', email: 'sofia.demo@tindog.local', name: 'Buddy', age: 3, breed: 'Golden Retriever', bio: 'Friendly, gentle, and happiest near water with a tennis ball.', image: '/assets/hero-dog.jpg', location: 'New York, NY', interests: ['fetch', 'swimming', 'walks'], vaccinated: true, neutered: true }
];
if (SEED_DEMO_DATA && db.prepare('SELECT COUNT(*) AS count FROM dogs').get().count === 0) {
  const seed = db.transaction(() => {
    for (const dog of demoDogs) {
      const user = db.prepare('INSERT OR IGNORE INTO users (owner_name, email, password_hash) VALUES (?, ?, ?)').run(dog.owner, dog.email, bcrypt.hashSync(crypto.randomUUID(), 10));
      const ownerId = Number(user.lastInsertRowid || db.prepare('SELECT id FROM users WHERE email = ?').get(dog.email).id);
      db.prepare(`INSERT OR IGNORE INTO dogs (owner_id, name, age_years, breed, bio, image_url, location, interests_json, vaccinated, neutered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ownerId, dog.name, dog.age, dog.breed, dog.bio, dog.image, dog.location, JSON.stringify(dog.interests), dog.vaccinated ? 1 : 0, dog.neutered ? 1 : 0);
    }
  });
  seed();
}
if (SEED_DEMO_DATA) {
  for (const dog of demoDogs) {
    db.prepare('UPDATE dogs SET image_url = ? WHERE owner_id = (SELECT id FROM users WHERE email = ?)').run(dog.image, dog.email);
  }
}

const publicUser = (user) => ({ id: user.id, ownerName: user.owner_name, email: user.email, role: user.role, verified: Boolean(user.email_verified), createdAt: user.created_at });
const subscriptionFromRow = (subscription) => subscription ? ({ id: subscription.id, planId: subscription.plan_id, planName: subscription.plan_name, provider: subscription.provider, status: subscription.status, startedAt: subscription.started_at, currentPeriodEnd: subscription.current_period_end }) : null;
const getSubscription = (userId) => subscriptionFromRow(db.prepare('SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ?').get(userId));
const sessionPayload = (user) => ({ user: publicUser(user), dog: dogFromRow(getCurrentDog(user.id)), subscription: getSubscription(user.id) });
const dogFromRow = (dog) => dog ? ({
  id: dog.id,
  ownerId: dog.owner_id,
  name: dog.name,
  age: dog.age_years,
  breed: dog.breed,
  bio: dog.bio,
  image: dog.image_url,
  location: dog.location,
  interests: JSON.parse(dog.interests_json || '[]'),
  vaccinated: Boolean(dog.vaccinated),
  neutered: Boolean(dog.neutered),
  createdAt: dog.created_at,
  updatedAt: dog.updated_at,
  verified: Boolean(dog.email_verified)
}) : null;
const planFromRow = (plan) => plan ? ({ ...plan, price: plan.price_cents / 100, features: JSON.parse(plan.features_json || '[]'), active: Boolean(plan.active) }) : null;
const compatibilityScore = (candidate, current) => {
  if (!candidate || !current) return 0;
  let score = 45;
  if (candidate.breed && current.breed && candidate.breed.toLowerCase() === current.breed.toLowerCase()) score += 18;
  if (candidate.location && current.location && candidate.location.toLowerCase() === current.location.toLowerCase()) score += 15;
  const ageGap = Math.abs(Number(candidate.age_years || 0) - Number(current.age_years || 0));
  score += Math.max(0, 15 - ageGap * 3);
  const candidateInterests = new Set(JSON.parse(candidate.interests_json || '[]').map((item) => String(item).toLowerCase()));
  const currentInterests = JSON.parse(current.interests_json || '[]').map((item) => String(item).toLowerCase());
  score += Math.min(12, currentInterests.filter((item) => candidateInterests.has(item)).length * 4);
  return Math.min(99, Math.max(1, score));
};
const signToken = (user) => jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const issueEmailToken = (userId, kind, hours) => {
  const token = crypto.randomBytes(48).toString('base64url');
  db.prepare("DELETE FROM email_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL").run(userId, kind);
  db.prepare('INSERT INTO email_tokens (user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, datetime(\'now\', ?))').run(userId, kind, hashToken(token), `+${hours} hours`);
  return token;
};
const sendEmail = async ({ to, subject, text, html }) => {
  if (!mailer) { const error = new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and EMAIL_FROM.'); error.status = 503; throw error; }
  await mailer.sendMail({ from: EMAIL_FROM, to, subject, text, html });
};
const sendVerificationEmail = async (user) => {
  const token = issueEmailToken(user.id, 'verify', 24);
  const link = `${APP_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail({ to: user.email, subject: 'Verify your TIN-DOG account', text: `Verify your TIN-DOG account: ${link}`, html: `<p>Verify your TIN-DOG account by clicking <a href="${link}">this link</a>.</p>` });
};

const authSchema = z.object({
  ownerName: z.string().trim().min(2).max(80),
  dogName: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  dogAge: z.coerce.number().int().min(0).max(30).default(1),
  dogBreed: z.string().trim().min(2).max(80).default('Mixed Breed'),
  dogBio: z.string().trim().max(500).default(''),
  location: z.string().trim().max(120).default('')
});
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) });
const profileSchema = z.object({
  ownerName: z.string().trim().min(2).max(80).optional(),
  dogName: z.string().trim().min(1).max(60),
  age: z.coerce.number().int().min(0).max(30),
  breed: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(500),
  location: z.string().trim().max(120),
  interests: z.string().transform((value) => {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.length > 30)) throw new Error('Invalid interests');
    return parsed.slice(0, 12);
  }),
  vaccinated: z.enum(['true', 'false']).transform((v) => v === 'true'),
  neutered: z.enum(['true', 'false']).transform((v) => v === 'true')
});
const swipeSchema = z.object({ dogId: z.coerce.number().int().positive(), action: z.enum(['like', 'pass', 'super']) });
const messageSchema = z.object({ content: z.string().trim().min(1).max(2000) });
const checkoutSchema = z.object({ planId: z.string().regex(/^[a-z0-9_-]+$/) });
const forgotPasswordSchema = z.object({ email: z.string().trim().email() });
const resetPasswordSchema = z.object({ token: z.string().min(32).max(256), password: z.string().min(8).max(128) });
const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(24) });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024) },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) return cb(null, true);
    const error = new Error('Only JPEG, PNG, WEBP, and GIF images are supported.');
    error.status = 400;
    error.expose = true;
    return cb(error);
  }
});

const allowedOrigins = new Set((process.env.CORS_ORIGINS || APP_URL).split(',').map((item) => item.trim()).filter(Boolean));
const isAllowedOrigin = (origin) => !origin || allowedOrigins.has(origin) || (process.env.NODE_ENV !== 'production' && new RegExp('^https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?$').test(origin));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (origin, callback) => isAllowedOrigin(origin) ? callback(null, true) : callback(new Error('Origin not allowed')), credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '1d' }));
if (fs.existsSync(CLIENT_INDEX)) app.use(express.static(CLIENT_DIST, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buffer) => {
    if (req.originalUrl.includes('/payments/stripe/webhook') || req.originalUrl.includes('/payments/razorpay/webhook')) {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { error: 'Too many authentication attempts. Try again later.' } });
const authenticate = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    req.user = user;
    next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
  next();
};
const parseBody = (schema, body) => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map((issue) => issue.message).join(', '));
    error.status = 400;
    throw error;
  }
  return parsed.data;
};
const getCurrentDog = (userId) => db.prepare('SELECT d.*, u.email_verified FROM dogs d JOIN users u ON u.id = d.owner_id WHERE d.owner_id = ?').get(userId);
const discoverDogs = (userId, query) => {
  const { page, limit } = parseBody(paginationSchema, query);
  const breed = String(query.breed || '').trim().toLowerCase();
  const location = String(query.location || '').trim().toLowerCase();
  const currentDog = getCurrentDog(userId);
  const whereArgs = [userId, userId, breed, breed, location, location];
  const where = `FROM dogs d JOIN users u ON u.id = d.owner_id WHERE d.owner_id != ? AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.user_id = ? AND s.dog_id = d.id) AND (? = '' OR lower(d.breed) LIKE '%' || ? || '%') AND (? = '' OR lower(d.location) LIKE '%' || ? || '%')`;
  const total = db.prepare(`SELECT COUNT(*) AS count ${where}`).get(...whereArgs).count;
  const dogs = db.prepare(`SELECT d.*, u.email_verified ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`).all(...whereArgs, limit, (page - 1) * limit).map((dog) => ({ ...dogFromRow(dog), compatibilityScore: compatibilityScore(dog, currentDog) }));
  return { dogs, currentDogId: currentDog?.id || null, page, limit, total, hasMore: page * limit < total };
};
const getMatchForUser = (conversationId, userId) => db.prepare(`
  SELECT c.id, c.match_id FROM conversations c JOIN matches m ON m.id = c.match_id
  WHERE c.id = ? AND (m.user_a_id = ? OR m.user_b_id = ?)
`).get(conversationId, userId, userId);
const activateSubscription = (order, providerSubscriptionId = null) => {
  db.prepare(`INSERT INTO subscriptions (user_id, plan_id, provider, provider_subscription_id, status) VALUES (?, ?, ?, ?, 'active') ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, provider = excluded.provider, provider_subscription_id = excluded.provider_subscription_id, status = 'active', updated_at = CURRENT_TIMESTAMP`).run(order.user_id, order.plan_id, order.provider, providerSubscriptionId);
};
const markOrderPaid = (order, providerPaymentId, providerSubscriptionId = null) => {
  const updated = db.prepare(`UPDATE orders SET status = 'paid', provider_payment_id = ?, provider_subscription_id = COALESCE(?, provider_subscription_id), paid_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'paid'`).run(providerPaymentId || null, providerSubscriptionId, order.id);
  if (updated.changes || !getSubscription(order.user_id)) activateSubscription(order, providerSubscriptionId || providerPaymentId);
};
const markOrderFailed = (order, providerPaymentId = null) => {
  if (!order) return;
  db.prepare(`UPDATE orders SET status = 'failed', provider_payment_id = COALESCE(?, provider_payment_id) WHERE id = ? AND status = 'pending'`).run(providerPaymentId, order.id);
  db.prepare(`UPDATE subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND provider = ? AND status = 'active'`).run(order.user_id, order.provider);
};
const updateSubscriptionStatus = (providerSubscriptionId, status, currentPeriodEnd = null) => {
  if (!providerSubscriptionId) return;
  db.prepare(`UPDATE subscriptions SET status = ?, current_period_end = COALESCE(?, current_period_end), updated_at = CURRENT_TIMESTAMP WHERE provider_subscription_id = ?`).run(status, currentPeriodEnd, providerSubscriptionId);
};

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, service: 'tin-dog', database: 'ok', timestamp: new Date().toISOString() });
  } catch (_error) {
    res.status(503).json({ ok: false, service: 'tin-dog', database: 'unavailable', timestamp: new Date().toISOString() });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const input = parseBody(authSchema, req.body);
    if (REQUIRE_EMAIL_VERIFICATION && !mailer) throw Object.assign(new Error('Email verification is enabled but SMTP is not configured.'), { status: 503, expose: true });
    const email = input.email.toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with that email already exists' });
    const passwordHash = bcrypt.hashSync(input.password, 12);
    const create = db.transaction(() => {
      const role = ADMIN_EMAILS.has(email) ? 'admin' : 'user';
      const userResult = db.prepare('INSERT INTO users (owner_name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(input.ownerName, email, passwordHash, role);
      const userId = Number(userResult.lastInsertRowid);
      db.prepare(`INSERT INTO dogs (owner_id, name, age_years, breed, bio, location) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(userId, input.dogName, input.dogAge, input.dogBreed, input.dogBio, input.location);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    });
    const user = create();
    let verificationSent = false;
    if (mailer) { try { await sendVerificationEmail(user); verificationSent = true; } catch (error) { if (REQUIRE_EMAIL_VERIFICATION) { db.transaction(() => { db.prepare('DELETE FROM users WHERE id = ?').run(user.id); })(); throw error; } } }
    const token = REQUIRE_EMAIL_VERIFICATION ? null : signToken(user);
    res.status(201).json({ ...sessionPayload(user), token, requiresEmailVerification: REQUIRE_EMAIL_VERIFICATION, verificationSent });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, (req, res, next) => {
  try {
    const input = parseBody(loginSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email.toLowerCase());
    if (!user || !bcrypt.compareSync(input.password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    if (REQUIRE_EMAIL_VERIFICATION && !user.email_verified) return res.status(403).json({ error: 'Please verify your email before logging in.' });
    res.json({ ...sessionPayload(user), token: signToken(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = parseBody(forgotPasswordSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(202).json({ message: 'If that account exists, recovery instructions have been sent.' });
    const token = issueEmailToken(user.id, 'reset', 1);
    const link = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail({ to: user.email, subject: 'Reset your TIN-DOG password', text: `Reset your TIN-DOG password: ${link}`, html: `<p>Reset your TIN-DOG password by clicking <a href="${link}">this link</a>.</p>` });
    res.status(202).json({ message: 'If that account exists, recovery instructions have been sent.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/resend-verification', authLimiter, async (req, res, next) => {
  try {
    const { email } = parseBody(forgotPasswordSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (user && !user.email_verified && mailer) await sendVerificationEmail(user);
    res.status(202).json({ message: 'If that account exists and still needs verification, a new verification email has been sent.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/reset-password', authLimiter, (req, res, next) => {
  try {
    const { token, password } = parseBody(resetPasswordSchema, req.body);
    const tokenRow = db.prepare("SELECT * FROM email_tokens WHERE token_hash = ? AND kind = 'reset' AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP").get(hashToken(token));
    if (!tokenRow) return res.status(400).json({ error: 'This password reset link is invalid or expired.' });
    const passwordHash = bcrypt.hashSync(password, 12);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, tokenRow.user_id);
      db.prepare('UPDATE email_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(tokenRow.id);
    })();
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) { next(error); }
});

app.get('/api/auth/verify-email', (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const tokenRow = db.prepare("SELECT * FROM email_tokens WHERE token_hash = ? AND kind = 'verify' AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP").get(hashToken(token));
    if (!tokenRow) return res.status(400).send('This email verification link is invalid or expired.');
    db.transaction(() => {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(tokenRow.user_id);
      db.prepare('UPDATE email_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(tokenRow.id);
    })();
    res.redirect(`${APP_URL}/?verified=1`);
  } catch (error) { next(error); }
});

app.get('/api/auth/me', authenticate, (req, res) => res.json(sessionPayload(req.user)));

app.get('/api/user/profile', authenticate, (req, res) => res.json(sessionPayload(req.user)));
app.put('/api/user/profile', authenticate, upload.single('image'), (req, res, next) => {
  try {
    const input = parseBody(profileSchema, req.body);
    const dog = getCurrentDog(req.user.id);
    if (!dog) return res.status(404).json({ error: 'Dog profile not found' });
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : dog.image_url;
    if (input.ownerName) db.prepare('UPDATE users SET owner_name = ? WHERE id = ?').run(input.ownerName, req.user.id);
    db.prepare(`UPDATE dogs SET name = ?, age_years = ?, breed = ?, bio = ?, location = ?, interests_json = ?, vaccinated = ?, neutered = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?`)
      .run(input.dogName, input.age, input.breed, input.bio, input.location, JSON.stringify(input.interests), input.vaccinated ? 1 : 0, input.neutered ? 1 : 0, imageUrl, req.user.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)), dog: dogFromRow(getCurrentDog(req.user.id)), subscription: getSubscription(req.user.id) });
  } catch (error) { next(error); }
});

app.get('/api/plans', (_req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY price_cents ASC').all().map(planFromRow);
  res.json({ plans, paymentProvider: PAYMENT_PROVIDER, currency: CURRENCY });
});

app.get('/api/dogs', authenticate, (req, res, next) => {
  try { res.json(discoverDogs(req.user.id, req.query)); } catch (error) { next(error); }
});

// Kept as a backwards-compatible alias, with the same exclusion and compatibility rules as the main discovery feed.
app.get('/api/dogs/search', authenticate, (req, res, next) => {
  try { res.json(discoverDogs(req.user.id, req.query)); } catch (error) { next(error); }
});

app.post('/api/swipes', authenticate, (req, res, next) => {
  try {
    const input = parseBody(swipeSchema, req.body);
    const targetDog = db.prepare('SELECT * FROM dogs WHERE id = ?').get(input.dogId);
    const ownDog = getCurrentDog(req.user.id);
    if (!targetDog || !ownDog) return res.status(404).json({ error: 'Dog profile not found' });
    if (targetDog.owner_id === req.user.id) return res.status(400).json({ error: 'You cannot swipe on your own dog' });
    db.prepare(`INSERT INTO swipes (user_id, dog_id, action) VALUES (?, ?, ?) ON CONFLICT(user_id, dog_id) DO UPDATE SET action = excluded.action, created_at = CURRENT_TIMESTAMP`)
      .run(req.user.id, targetDog.id, input.action);
    let match = null;
    if (input.action === 'like' || input.action === 'super') {
      const reciprocal = db.prepare("SELECT id FROM swipes WHERE user_id = ? AND dog_id = ? AND action IN ('like', 'super')").get(targetDog.owner_id, ownDog.id);
      if (reciprocal) {
        const a = Math.min(req.user.id, targetDog.owner_id);
        const b = Math.max(req.user.id, targetDog.owner_id);
        match = db.prepare('SELECT * FROM matches WHERE user_a_id = ? AND user_b_id = ?').get(a, b);
        if (!match) {
          const result = db.prepare('INSERT INTO matches (user_a_id, user_b_id) VALUES (?, ?)').run(a, b);
          match = db.prepare('SELECT * FROM matches WHERE id = ?').get(result.lastInsertRowid);
          db.prepare('INSERT INTO conversations (match_id) VALUES (?)').run(match.id);
        }
      }
    }
    res.json({ action: input.action, isMatch: Boolean(match), matchId: match?.id || null });
  } catch (error) { next(error); }
});

app.get('/api/matches', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, c.id AS conversation_id,
      u.id AS other_user_id, u.owner_name AS other_owner_name,
      d.id AS other_dog_id, d.name AS other_dog_name, d.age_years AS other_dog_age,
      d.breed AS other_dog_breed, d.bio AS other_dog_bio, d.image_url AS other_dog_image,
      d.location AS other_dog_location
    FROM matches m
    JOIN users u ON u.id = CASE WHEN m.user_a_id = ? THEN m.user_b_id ELSE m.user_a_id END
    JOIN dogs d ON d.owner_id = u.id
    JOIN conversations c ON c.match_id = m.id
    WHERE (m.user_a_id = ? OR m.user_b_id = ?) AND m.status = 'active'
    ORDER BY m.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
  const matches = rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    conversationId: row.conversation_id,
    otherUser: { id: row.other_user_id, ownerName: row.other_owner_name },
    dog: { id: row.other_dog_id, name: row.other_dog_name, age: row.other_dog_age, breed: row.other_dog_breed, bio: row.other_dog_bio, image: row.other_dog_image, location: row.other_dog_location }
  }));
  res.json({ matches });
});

app.post('/api/matches/:matchId/unmatch', authenticate, (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)').get(Number(req.params.matchId), req.user.id, req.user.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  db.prepare("UPDATE matches SET status = 'unmatched' WHERE id = ?").run(match.id);
  res.json({ success: true, matchId: match.id, status: 'unmatched' });
});

app.get('/api/conversations/:conversationId/messages', authenticate, (req, res) => {
  const conversation = getMatchForUser(Number(req.params.conversationId), req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const messages = db.prepare(`SELECT m.id, m.body AS content, m.created_at AS createdAt, m.sender_id AS senderId, u.owner_name AS senderName FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? ORDER BY m.created_at ASC`).all(conversation.id);
  db.prepare('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND sender_id != ?').run(conversation.id, req.user.id);
  res.json({ messages });
});

app.post('/api/conversations/:conversationId/messages', authenticate, (req, res, next) => {
  try {
    const conversation = getMatchForUser(Number(req.params.conversationId), req.user.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const input = parseBody(messageSchema, req.body);
    const result = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').run(conversation.id, req.user.id, input.content);
    const message = db.prepare(`SELECT id, body AS content, created_at AS createdAt, sender_id AS senderId FROM messages WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json({ message });
  } catch (error) { next(error); }
});

app.get('/api/billing/orders', authenticate, (req, res) => {
  const orders = db.prepare(`SELECT o.*, p.name AS plan_name FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.user_id = ? ORDER BY o.created_at DESC`).all(req.user.id)
    .map((order) => ({ id: order.id, planId: order.plan_id, planName: order.plan_name, provider: order.provider, status: order.status, amount: order.amount_cents / 100, currency: order.currency, createdAt: order.created_at, paidAt: order.paid_at }));
  res.json({ orders });
});

function assertPaymentConfigured() {
  if (PAYMENT_PROVIDER === 'razorpay' && (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)) {
    throw Object.assign(new Error('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'), { status: 503, expose: true });
  }
  if (PAYMENT_PROVIDER !== 'razorpay' && !process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('Stripe is not configured. Add STRIPE_SECRET_KEY.'), { status: 503, expose: true });
  }
}

async function createStripeCheckout(order, plan, user) {
  if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Stripe is not configured. Add STRIPE_SECRET_KEY.'), { status: 503, expose: true });
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: plan.interval === 'one_time' ? 'payment' : 'subscription',
    customer_email: user.email,
    line_items: [{ price_data: { currency: plan.currency, product_data: { name: `TIN-DOG ${plan.name}` }, unit_amount: plan.price_cents, ...(plan.interval !== 'one_time' ? { recurring: { interval: plan.interval } } : {}) }, quantity: 1 }],
    metadata: { orderId: String(order.id), userId: String(user.id), planId: plan.id },
    success_url: `${APP_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/?payment=cancelled`
  });
  db.prepare('UPDATE orders SET provider_order_id = ? WHERE id = ?').run(session.id, order.id);
  return { provider: 'stripe', checkoutUrl: session.url, orderId: order.id };
}

async function createRazorpayOrder(order, plan) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw Object.assign(new Error('Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'), { status: 503, expose: true });
  const Razorpay = require('razorpay');
  const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  const providerOrder = await razorpay.orders.create({ amount: plan.price_cents, currency: plan.currency.toUpperCase(), receipt: `tindog-${order.id}`, notes: { orderId: String(order.id), planId: plan.id } });
  db.prepare('UPDATE orders SET provider_order_id = ? WHERE id = ?').run(providerOrder.id, order.id);
  return { provider: 'razorpay', keyId: process.env.RAZORPAY_KEY_ID, providerOrderId: providerOrder.id, amount: providerOrder.amount, currency: providerOrder.currency, orderId: order.id };
}

app.post('/api/payments/checkout', authenticate, async (req, res, next) => {
  try {
    const input = parseBody(checkoutSchema, req.body);
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(input.planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.price_cents === 0) {
      const result = db.prepare("INSERT INTO orders (user_id, plan_id, provider, amount_cents, currency) VALUES (?, ?, 'free', 0, ?)").run(req.user.id, plan.id, plan.currency);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
      markOrderPaid(order, 'free');
      return res.json({ provider: 'free', orderId: order.id, activated: true });
    }
    assertPaymentConfigured();
    const result = db.prepare('INSERT INTO orders (user_id, plan_id, provider, amount_cents, currency) VALUES (?, ?, ?, ?, ?)').run(req.user.id, plan.id, PAYMENT_PROVIDER, plan.price_cents, plan.currency);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
    const payment = PAYMENT_PROVIDER === 'razorpay' ? await createRazorpayOrder(order, plan) : await createStripeCheckout(order, plan, req.user);
    res.status(201).json(payment);
  } catch (error) { next(error); }
});

app.post('/api/payments/razorpay/verify', authenticate, (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body || {};
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !orderId) return res.status(400).json({ error: 'Payment verification fields are required' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(orderId), req.user.id);
    if (!order || order.provider_order_id !== razorpayOrderId) return res.status(404).json({ error: 'Order not found' });
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
    if (razorpaySignature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpaySignature))) return res.status(400).json({ error: 'Invalid payment signature' });
    markOrderPaid(order, razorpayPaymentId);
    res.json({ success: true, orderId: order.id, status: 'paid' });
  } catch (error) { next(error); }
});

app.get('/api/payments/stripe/session/:sessionId', authenticate, async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Stripe is not configured' });
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(session.metadata?.orderId), req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (session.payment_status === 'paid') markOrderPaid(order, session.payment_intent || session.subscription);
    res.json({ order: db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) });
  } catch (error) { next(error); }
});

app.post('/api/payments/stripe/webhook', (req, res, next) => {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return res.status(503).send('Stripe is not configured');
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(req.rawBody || Buffer.from(JSON.stringify(req.body || {})), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    const inserted = db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, event_type, payload_json) VALUES (?, ?, ?, ?)').run('stripe', event.id, event.type, JSON.stringify(event));
    if (inserted.changes) {
      const payload = event.data.object;
      if (event.type === 'checkout.session.completed') {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(payload.metadata?.orderId));
        if (order && payload.payment_status === 'paid') markOrderPaid(order, payload.payment_intent || payload.subscription, payload.subscription);
      } else if (event.type === 'invoice.payment_failed') {
        const order = db.prepare('SELECT * FROM orders WHERE provider_subscription_id = ? OR provider_order_id = ?').get(payload.subscription, payload.id);
        if (order) markOrderFailed(order, payload.payment_intent);
        updateSubscriptionStatus(payload.subscription, 'past_due');
      } else if (event.type === 'invoice.paid') {
        updateSubscriptionStatus(payload.subscription, 'active', payload.period_end ? new Date(payload.period_end * 1000).toISOString() : null);
      } else if (event.type === 'customer.subscription.updated') {
        const status = payload.status === 'active' || payload.status === 'trialing' ? 'active' : payload.status === 'past_due' ? 'past_due' : 'cancelled';
        updateSubscriptionStatus(payload.id, status, payload.current_period_end ? new Date(payload.current_period_end * 1000).toISOString() : null);
      } else if (event.type === 'customer.subscription.deleted') {
        updateSubscriptionStatus(payload.id, 'cancelled');
      }
    }
    res.json({ received: true });
  } catch (error) { next(error); }
});

app.post('/api/payments/razorpay/webhook', (req, res, next) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).send('Razorpay is not configured');
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(400).send('Invalid signature');
    const event = JSON.parse(rawBody.toString('utf8'));
    const inserted = db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, event_type, payload_json) VALUES (?, ?, ?, ?)').run('razorpay', req.headers['x-razorpay-event-id'] || crypto.createHash('sha256').update(rawBody).digest('hex'), event.event, JSON.stringify(event));
    if (inserted.changes) {
      const payment = event.payload?.payment?.entity;
      if (event.event === 'payment.captured' && payment) {
        const order = db.prepare('SELECT * FROM orders WHERE provider_order_id = ?').get(payment.order_id);
        if (order) markOrderPaid(order, payment.id);
      } else if (event.event === 'payment.failed' && payment) {
        const order = db.prepare('SELECT * FROM orders WHERE provider_order_id = ?').get(payment.order_id);
        if (order) markOrderFailed(order, payment.id);
      } else if (event.event === 'subscription.activated' || event.event === 'subscription.charged') {
        const subscription = event.payload?.subscription?.entity;
        updateSubscriptionStatus(subscription?.id, 'active', subscription?.current_end ? new Date(subscription.current_end * 1000).toISOString() : null);
      } else if (event.event === 'subscription.halted') {
        updateSubscriptionStatus(event.payload?.subscription?.entity?.id, 'past_due');
      } else if (event.event === 'subscription.cancelled') {
        updateSubscriptionStatus(event.payload?.subscription?.entity?.id, 'cancelled');
      }
    }
    res.json({ received: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/stats', authenticate, requireAdmin, (_req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    dogs: db.prepare('SELECT COUNT(*) AS count FROM dogs').get().count,
    matches: db.prepare("SELECT COUNT(*) AS count FROM matches WHERE status = 'active'").get().count,
    messages: db.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
    paidOrders: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid'").get().count,
    revenue: db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM orders WHERE status = 'paid'").get().cents / 100
  });
});

app.get('/api/admin/users', authenticate, requireAdmin, (_req, res) => {
  const users = db.prepare(`SELECT u.id, u.owner_name AS ownerName, u.email, u.role, u.created_at AS createdAt, d.name AS dogName, d.breed, s.status AS subscriptionStatus, p.name AS planName FROM users u LEFT JOIN dogs d ON d.owner_id = u.id LEFT JOIN subscriptions s ON s.user_id = u.id LEFT JOIN plans p ON p.id = s.plan_id ORDER BY u.created_at DESC LIMIT 200`).all();
  res.json({ users });
});

app.get('/api/stats', (_req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    dogs: db.prepare('SELECT COUNT(*) AS count FROM dogs').get().count,
    matches: db.prepare('SELECT COUNT(*) AS count FROM matches WHERE status = \'active\'').get().count,
    messages: db.prepare('SELECT COUNT(*) AS count FROM messages').get().count
  };
  res.json(stats);
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route not found' });
  if (fs.existsSync(CLIENT_INDEX)) return res.sendFile(CLIENT_INDEX);
  return res.status(404).send('TIN-DOG client build not found. Run npm run build.');
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = Number(err.status || 500);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Something went wrong on the server' : err.message });
});

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`TIN-DOG running at ${APP_URL}`));
  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down gracefully`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, db };
