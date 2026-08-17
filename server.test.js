const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const testDb = path.join(__dirname, 'data', 'test.sqlite');
fs.rmSync(testDb, { force: true });
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = testDb;
process.env.JWT_SECRET = 'test-secret-with-more-than-32-characters';
process.env.APP_URL = 'http://localhost:3000';
process.env.SEED_DEMO_DATA = 'true';
process.env.PAYMENT_PROVIDER = 'stripe';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

const { app, db } = require('./server');

describe('TIN-DOG API', () => {
  let token;
  let userDogId;

  it('returns public plans and seeded discovery dogs', async () => {
    const plans = await request(app).get('/api/plans').expect(200);
    expect(plans.body.plans.length).toBeGreaterThanOrEqual(3);
    await request(app).get('/api/dogs').expect(401);
  });

  it('registers a user and returns a bearer token', async () => {
    const response = await request(app).post('/api/auth/register').send({
      ownerName: 'Test Owner',
      dogName: 'Test Pup',
      dogAge: 2,
      dogBreed: 'Labrador',
      email: 'test@example.com',
      password: 'strong-password-123'
    }).expect(201);
    expect(response.body.token).toBeTruthy();
    expect(response.body.user.email).toBe('test@example.com');
    userDogId = response.body.dog.id;
    token = response.body.token;
  });

  it('activates the free plan and exposes subscription state', async () => {
    const checkout = await request(app).post('/api/payments/checkout').set('Authorization', `Bearer ${token}`).send({ planId: 'free' }).expect(200);
    expect(checkout.body.activated).toBe(true);
    const session = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(session.body.subscription.planId).toBe('free');
    expect(session.body.subscription.status).toBe('active');
    const orders = await request(app).get('/api/billing/orders').set('Authorization', `Bearer ${token}`).expect(200);
    expect(orders.body.orders[0].status).toBe('paid');
    expect(orders.body.orders[0].planId).toBe('free');
  });

  it('does not create a paid order when the provider is not configured', async () => {
    const before = await request(app).get('/api/billing/orders').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).post('/api/payments/checkout').set('Authorization', `Bearer ${token}`).send({ planId: 'plus' }).expect(503).expect((response) => {
      expect(response.body.error).toContain('Stripe is not configured');
    });
    const after = await request(app).get('/api/billing/orders').set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.orders.length).toBe(before.body.orders.length);
  });

  it('rejects invalid login and accepts valid login', async () => {
    await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'wrong-password' }).expect(401);
    const response = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'strong-password-123' }).expect(200);
    expect(response.body.token).toBeTruthy();
  });

  it('returns the authenticated session and updates the profile', async () => {
    const session = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(session.body.dog.id).toBe(userDogId);
    const profile = await request(app).put('/api/user/profile').set('Authorization', `Bearer ${token}`).field({
      ownerName: 'Updated Owner', dogName: 'Updated Pup', age: '3', breed: 'Labrador', location: 'Austin, TX', bio: 'Friendly and playful.', interests: JSON.stringify(['walks', 'fetch']), vaccinated: 'true', neutered: 'true'
    }).expect(200);
    expect(profile.body.dog.name).toBe('Updated Pup');
    expect(profile.body.dog.location).toBe('Austin, TX');
    expect(profile.body.user.ownerName).toBe('Updated Owner');
  });

  it('supports a real mutual-like flow and creates a conversation', async () => {
    const dogs = await request(app).get('/api/dogs').set('Authorization', `Bearer ${token}`).expect(200);
    const target = dogs.body.dogs[0];
    expect(target.compatibilityScore).toBeGreaterThan(0);
    const first = await request(app).post('/api/swipes').set('Authorization', `Bearer ${token}`).send({ dogId: target.id, action: 'super' }).expect(200);
    expect(first.body.isMatch).toBe(false);
    const searchAfterSwipe = await request(app).get(`/api/dogs/search?breed=${encodeURIComponent(target.breed)}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(searchAfterSwipe.body.dogs.some((dog) => dog.id === target.id)).toBe(false);
    db.prepare('INSERT INTO swipes (user_id, dog_id, action) VALUES (?, ?, ?)').run(target.ownerId, userDogId, 'like');
    const second = await request(app).post('/api/swipes').set('Authorization', `Bearer ${token}`).send({ dogId: target.id, action: 'like' }).expect(200);
    expect(second.body.isMatch).toBe(true);
    const matches = await request(app).get('/api/matches').set('Authorization', `Bearer ${token}`).expect(200);
    expect(matches.body.matches.length).toBe(1);
    const conversation = await request(app).post(`/api/conversations/${matches.body.matches[0].conversationId}/messages`).set('Authorization', `Bearer ${token}`).send({ content: 'Hello from the test suite!' }).expect(201);
    expect(conversation.body.message.content).toBe('Hello from the test suite!');
    await request(app).post(`/api/matches/${matches.body.matches[0].id}/unmatch`).set('Authorization', `Bearer ${token}`).expect(200);
    const unmatched = await request(app).get('/api/matches').set('Authorization', `Bearer ${token}`).expect(200);
    expect(unmatched.body.matches.length).toBe(0);
  });

  it('returns pagination metadata and protects privileged and recovery endpoints', async () => {
    const page = await request(app).get('/api/dogs?page=1&limit=1').set('Authorization', `Bearer ${token}`).expect(200);
    expect(page.body.page).toBe(1);
    expect(page.body.limit).toBe(1);
    expect(typeof page.body.hasMore).toBe('boolean');
    await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${token}`).expect(403);
    await request(app).post('/api/auth/forgot-password').send({ email: 'unknown@example.com' }).expect(202);
    await request(app).post('/api/auth/reset-password').send({ token: 'invalid-token', password: 'new-strong-password-123' }).expect(400);
    await request(app).get('/api/auth/verify-email?token=invalid-token').expect(400);
  });

  afterAll(() => db.close());
});
