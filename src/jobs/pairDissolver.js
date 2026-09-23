import Pair from '../models/Pair.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

const INACTIVE_DAYS = 14;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export async function dissolveInactivePairs() {
    const cutoff = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);

    try {
        const stalePairs = await Pair.find({
            status: 'active',
            lastActivityAt: { $lt: cutoff }
        });

        if (stalePairs.length === 0) {
            return { dissolved: 0 };
        }

        for (const pair of stalePairs) {
            pair.status = 'dissolved';
            pair.endedAt = new Date();
            pair.endReason = 'inactive';
            await pair.save();

            await User.findByIdAndUpdate(pair.userA, { $inc: { activePairs: -1 } });
            await User.findByIdAndUpdate(pair.userB, { $inc: { activePairs: -1 } });

            await Notification.insertMany([
                {
                    userId: pair.userA,
                    type: 'pair_ended',
                    pairId: pair._id,
                    content: 'Your language exchange pair was dissolved due to 14 days of inactivity'
                },
                {
                    userId: pair.userB,
                    type: 'pair_ended',
                    pairId: pair._id,
                    content: 'Your language exchange pair was dissolved due to 14 days of inactivity'
                }
            ]);
        }

        console.log(`🤝 Dissolved ${stalePairs.length} inactive pairs`);
        return { dissolved: stalePairs.length };
    } catch (error) {
        console.error('Dissolve inactive pairs error:', error);
        return { dissolved: 0, error: error.message };
    }
}

export function startPairDissolver() {
    // Run once at startup (after a short delay to let DB connect)
    setTimeout(dissolveInactivePairs, 30 * 1000);

    // Then run periodically
    setInterval(dissolveInactivePairs, CHECK_INTERVAL_MS);

    console.log('🤝 Pair dissolver started (runs every 6h, dissolves after 14d inactive)');
}