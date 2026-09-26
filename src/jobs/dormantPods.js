import Pod from '../models/Pod.js';

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;   // every 12 hours
const DORMANT_DAYS = 30;
const MIN_MEMBERS_TO_KEEP = 2;

/**
 * Deactivate pods that:
 *   - haven't been updated in 30 days
 *   - have fewer than 2 members
 */
export async function deactivateDormantPods() {
    const cutoff = new Date(Date.now() - DORMANT_DAYS * 24 * 60 * 60 * 1000);

    try {
        const result = await Pod.updateMany(
            {
                isActive: true,
                updatedAt: { $lt: cutoff },
                $expr: { $lt: [{ $size: '$members' }, MIN_MEMBERS_TO_KEEP] }
            },
            {
                $set: { isActive: false }
            }
        );

        if (result.modifiedCount > 0) {
            console.log(`💤 Deactivated ${result.modifiedCount} dormant pods`);
        }
        return { deactivated: result.modifiedCount };
    } catch (error) {
        console.error('Dormant pod job error:', error);
        return { deactivated: 0, error: error.message };
    }
}

export function startDormantPodJob() {
    setTimeout(deactivateDormantPods, 60 * 1000);
    setInterval(deactivateDormantPods, CHECK_INTERVAL_MS);
    console.log('💤 Dormant pod job started (runs every 12h, deactivates after 30d)');
}