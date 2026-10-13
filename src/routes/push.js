/* ============================================================
   Push notification routes
   - GET  /api/push/vapid-public-key  (public)
   - POST /api/push/subscribe         (auth)
   - DEL  /api/push/unsubscribe       (auth)
   - POST /api/push/test              (auth)
   ============================================================ */

import express from 'express';
import PushSubscription from '../models/PushSubscription.js';
import { authenticateUser } from '../middleware/auth.js';
import { sendPushToUser } from '../services/pushService.js';

const router = express.Router();

/* ---------- GET /api/push/vapid-public-key ---------- */
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Push not configured on server' });
  }
  res.set('Cache-Control', 'public, max-age=86400');
  res.json({ publicKey: key });
});

/* ---------- POST /api/push/subscribe ---------- */
router.post('/subscribe', authenticateUser, async (req, res) => {
  const { endpoint, keys, userAgent } = req.body || {};

  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'endpoint is required' });
  }
  if (!keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'keys.p256dh and keys.auth are required' });
  }

  try {
    // Upsert on endpoint — a browser can re-subscribe with the same endpoint
    // after a page reload, and we don't want duplicate rows.
    const doc = await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId: req.userId,
        endpoint,
        keys: {
          p256dh: String(keys.p256dh),
          auth: String(keys.auth)
        },
        userAgent: String(userAgent || req.headers['user-agent'] || '').slice(0, 300)
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      subscriptionId: doc._id
    });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(400).json({ error: error.message });
  }
});

/* ---------- DELETE /api/push/unsubscribe ---------- */
router.delete('/unsubscribe', authenticateUser, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });

  try {
    await PushSubscription.findOneAndDelete({
      endpoint,
      userId: req.userId
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Push unsubscribe error:', error);
    res.status(400).json({ error: error.message });
  }
});

/* ---------- POST /api/push/test ---------- */
router.post('/test', authenticateUser, async (req, res) => {
  try {
    const result = await sendPushToUser(req.userId, {
      title: 'ClearWords 👋',
      body: "If you're seeing this, push notifications work.",
      url: '/learn.html',
      tag: 'cw-test'
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Push test error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;