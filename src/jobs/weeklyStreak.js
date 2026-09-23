import Pod from '../models/Pod.js';
import PodMessage from '../models/PodMessage.js';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // every hour

/**
 * If a pod didn't hit its weekly goal, reset sharedStreak to 0.
 * Runs hourly and checks against the start of the current week.
 */
export async function resetBrokenStreaks() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    try {
        // Pods with an active streak whose last check is before this week
        const pods = await Pod.find({
            isActive: true,
            sharedStreak: { $gt: 0 },
            $or: [
                { lastStreakCheck: null },
                { lastStreakCheck: { $lt: startOfWeek } }
            ]
        });

        let resetCount = 0;

        for (const pod of pods) {
            // Did at least half the members check in this week?
            const checkinsThisWeek = await PodMessage.distinct('authorId', {
                podId: pod._id,
                type: 'checkin',
                createdAt: { $gte: startOfWeek }
            });

            const hitGoal = checkinsThisWeek.length >= Math.ceil(pod.members.length / 2);

            if (!hitGoal) {
                pod.sharedStreak = 0;
                await pod.save();
                resetCount++;
            }
        }

        if (resetCount > 0) {
            console.log(`🔥 Reset ${resetCount} pod streaks`);
        }
        return { reset: resetCount };
    } catch (error) {
        console.error('Weekly streak reset error:', error);
        return { reset: 0, error: error.message };
    }
}

export function startWeeklyStreakJob() {
    // Run once at startup (after a short delay to let DB connect)
    setTimeout(resetBrokenStreaks, 45 * 1000);

    // Then run periodically
    setInterval(resetBrokenStreaks, CHECK_INTERVAL_MS);

    console.log('🔥 Weekly streak job started (runs hourly)');
}