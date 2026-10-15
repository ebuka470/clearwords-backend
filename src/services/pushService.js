import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';

let _configured = false;

function ensureConfigured() {
  if (_configured) return true;
  const subject = process.env.VAPID_SUBJECT;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !pub || !priv) {
    console.warn('[Push] VAPID env vars missing — push disabled');
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  _configured = true;
  return true;
}

/**
 * Send a push notification to every subscription a user has.
 * Silently removes subscriptions that the push service has rejected.
 *
 * payload: { title, body, url?, icon?, tag?, actions?, data? }
 * returns: { sent, failed }
 */
// services/pushService.js
export async function sendPushToUser(userId, payload, { urgency = 'normal' } = {}) {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };

  const subs = await PushSubscription.find({ userId });
  if (!subs.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }
        },
        body,
        { 
          TTL: 60 * 60 * 24,
          urgency: urgency // 👈 Add this line
        }
      );
      sent++;
      // ... rest of the code
    } catch (err) {
      // ... error handling
    }
  }));

  return { sent, failed };
}

/**
 * Fan out to many users. Returns an array of per-user results.
 */
export async function sendPushToUsers(userIds, payload) {
  const unique = [...new Set(userIds.map(String))];
  return Promise.all(unique.map(id => sendPushToUser(id, payload)));
}