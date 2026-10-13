/* ============================================================
   Streak reminder
   Runs once an hour. For each user whose local time is between
   7pm and 8pm, and who hasn't completed a lesson today, sends
   a push reminder — but only if they have an active streak
   (i.e. something to lose) and push notifications enabled.
   ============================================================ */

import User from '../models/User.js';
import Progress from '../models/Progress.js';
import { sendPushToUser } from '../services/pushService.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // every hour
const REMINDER_HOUR_START = 19; // 7pm
const REMINDER_HOUR_END = 20;   // 8pm
const REMINDER_FLAG_PREFIX = 'cw_streak_reminder_sent_';

// In-memory guard so we don't spam a user twice in the same hour
const _recentlyReminded = new Map();

function todayKey(offsetMinutes) {
  const now = new Date();
  if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
    const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10);
}

function userHour(offsetMinutes) {
  const now = new Date();
  if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
    const shifted = new Date(now.getTime() + offsetMinutes * 60 * 1000);
    return shifted.getUTCHours();
  }
  return now.getUTCHours();
}

export async function sendStreakReminders() {
  try {
    // Find users who:
    //   - have notifications enabled
    //   - have a non-zero streak (something to lose)
    //   - have a timezone offset we can use
    //   - are not banned
    const users = await User.find({
      notificationsEnabled: true,
      streak: { $gt: 0 },
      timezoneOffsetMinutes: { $ne: null },
      isBanned: false
    }).select('_id fullName language timezoneOffsetMinutes streak lastActive streakReminderDate');

    let sent = 0;

    for (const user of users) {
      const localHour = userHour(user.timezoneOffsetMinutes);
      if (localHour < REMINDER_HOUR_START || localHour >= REMINDER_HOUR_END) continue;

      const today = todayKey(user.timezoneOffsetMinutes);

      // Already reminded today?
      if (user.streakReminderDate === today) continue;

      // Already practiced today?
      const progress = await Progress.findOne({
        userId: user._id,
        language: user.language
      }).select('lastCompletedDate');

      if (progress?.lastCompletedDate === today) continue;

      // Debounce in memory in case two cron ticks overlap
      const key = `${user._id}:${today}`;
      if (_recentlyReminded.has(key)) continue;
      _recentlyReminded.set(key, Date.now());

      // Send the push
      const streak = user.streak || 0;
      const firstName = (user.fullName || '').split(' ')[0] || 'friend';

      await sendPushToUser(user._id, {
        title: `🔥 ${streak}-day streak, ${firstName}`,
        body: "5 minutes today keeps it going. Timmy's waiting.",
        url: '/learn.html',
        tag: 'cw-streak-reminder',
        renotify: false
      }).catch(() => {});

      // Mark so we don't re-send today
      await User.updateOne(
        { _id: user._id },
        { $set: { streakReminderDate: today } }
      ).catch(() => {});

      sent++;
    }

    // Prune the in-memory debounce map once a day (keep it small)
    if (_recentlyReminded.size > 5000) {
      const cutoff = Date.now() - 25 * 60 * 60 * 1000;
      for (const [k, t] of _recentlyReminded) {
        if (t < cutoff) _recentlyReminded.delete(k);
      }
    }

    if (sent > 0) console.log(`🔔 Sent ${sent} streak reminder${sent === 1 ? '' : 's'}`);
    return { sent };
  } catch (error) {
    console.error('Streak reminder job error:', error);
    return { sent: 0, error: error.message };
  }
}

export function startStreakReminderJob() {
  // First run 90s after boot so the DB is definitely warm
  setTimeout(() => {
    sendStreakReminders().catch(() => {});
  }, 90 * 1000);

  // Then hourly
  setInterval(() => {
    sendStreakReminders().catch(() => {});
  }, CHECK_INTERVAL_MS);

  console.log('🔔 Streak reminder job started (runs hourly, 7–8pm local)');
}