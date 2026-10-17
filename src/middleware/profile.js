import mongoose from 'mongoose';
import User from '../models/User.js';

/**
 * Runs AFTER authenticateUser.
 *
 * Reads the `x-profile-id` header. If present and valid, sets
 * req.profileId to that ObjectId. Otherwise req.profileId is null
 * (which is the "personal account" behavior — all queries fall back
 * to rows where profileId is null).
 *
 * Safety: verifies the profile actually belongs to req.user.familyProfiles.
 * Does NOT check the subscription tier — a user whose plan lapsed must
 * still be able to read, rename, and delete their existing profiles.
 */
export async function resolveProfile(req, res, next) {
    req.profileId = null;

    const raw = req.headers['x-profile-id'];
    if (!raw) return next();

    const headerValue = String(raw).trim();
    if (!headerValue) return next();

    if (!mongoose.Types.ObjectId.isValid(headerValue)) {
        return res.status(400).json({ error: 'Invalid x-profile-id header' });
    }

    // req.user is set by authenticateUser
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const match = (user.familyProfiles || []).find(
        p => p._id.toString() === headerValue
    );

    if (!match) {
        return res.status(403).json({
            error: 'Profile does not belong to this account'
        });
    }

    req.profileId = match._id;
    next();
}

export default resolveProfile;