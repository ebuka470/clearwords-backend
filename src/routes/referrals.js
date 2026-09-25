import express from 'express';
import User from '../models/User.js';
import Referral from '../models/Referral.js';
import Subscription from '../models/Subscription.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// ============================================
// CONFIG
// ============================================
const REFERRALS_PER_REWARD = 12;         // 12 qualified referrals
const REWARD_DAYS = 30;                  // = 30 days of Premium

// ============================================
// GET /api/referrals/me
// Returns the current user's referral status
// ============================================
router.get('/me', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const [pending, qualified, rewarded, recent] = await Promise.all([
            Referral.countDocuments({ referrerId: user._id, status: 'pending' }),
            Referral.countDocuments({ referrerId: user._id, status: 'qualified' }),
            Referral.countDocuments({ referrerId: user._id, status: 'rewarded' }),
            Referral.find({ referrerId: user._id })
                .sort({ createdAt: -1 })
                .limit(20)
                .select('referredEmail status signedUpAt completedFirstLessonAt rewardedAt rewardDays')
        ]);

        const totalQualified = qualified + rewarded;
        const blocksEarned = Math.floor(totalQualified / REFERRALS_PER_REWARD);
        const progressInCurrentBlock = totalQualified % REFERRALS_PER_REWARD;
        const nextRewardAt = REFERRALS_PER_REWARD - progressInCurrentBlock;

        res.json({
            referralCode: user.referralCode,
            shareUrl: `https://clearwords.com.ng/join?ref=${user.referralCode}`,
            stats: {
                pending,
                qualified,
                rewarded,
                totalQualified,
                blocksEarned,
                progressInCurrentBlock,
                referralsPerReward: REFERRALS_PER_REWARD,
                nextRewardAt: blocksEarned * REFERRALS_PER_REWARD + REFERRALS_PER_REWARD,
                rewardDays: REWARD_DAYS
            },
            recentReferrals: recent
        });
    } catch (error) {
        console.error('Get referral status error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// POST /api/referrals/redeem
// Applied during signup OR manually by a user
// Body: { code }
// ============================================
router.post('/redeem', authenticateUser, async (req, res) => {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Referral code is required' });
    }

    const normalizedCode = code.trim().toUpperCase();

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Can't redeem if already referred
        if (user.referredBy) {
            return res.status(400).json({ error: 'You already redeemed a referral code' });
        }

        const referrer = await User.findOne({ referralCode: normalizedCode });
        if (!referrer) {
            return res.status(404).json({ error: 'Invalid referral code' });
        }

        // Self-referral block
        if (referrer._id.toString() === user._id.toString()) {
            return res.status(400).json({ error: 'You cannot refer yourself' });
        }

        // Prevent an existing Referral record for this user
        const existing = await Referral.findOne({ referredUserId: user._id });
        if (existing) {
            return res.status(400).json({ error: 'Referral already recorded for this account' });
        }

        // Record the referral (status: pending — qualifies after first lesson)
        await Referral.create({
            referrerId: referrer._id,
            referrerCode: referrer.referralCode,
            referredUserId: user._id,
            referredEmail: user.email,
            referredAuth0Id: user.auth0Id,
            status: 'pending'
        });

        // Mark on user
        user.referredBy = referrer._id;
        await user.save();

        // Update referrer's pending count
        await User.findByIdAndUpdate(referrer._id, { $inc: { pendingReferrals: 1 } });

        // Notify referrer
        await Notification.create({
            userId: referrer._id,
            type: 'referral_signup',
            sourceId: user._id,
            sourceUsername: user.username || 'User',
            sourceAvatar: user.avatarUrl || '',
            content: `${user.fullName || 'Someone'} signed up with your code! They'll count once they finish their first lesson.`
        });

        res.json({
            success: true,
            message: 'Referral recorded. It will count once you complete your first lesson.',
            referrer: {
                username: referrer.username,
                fullName: referrer.fullName
            }
        });
    } catch (error) {
        console.error('Redeem referral error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// POST /api/referrals/claim
// Manually claim reward (in case auto-claim missed)
// Normally triggered automatically when a referral qualifies
// ============================================
router.post('/claim', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const rewardedCount = await Referral.countDocuments({
            referrerId: user._id,
            status: 'rewarded'
        });
        const qualifiedCount = await Referral.countDocuments({
            referrerId: user._id,
            status: 'qualified'
        });

        const totalQualified = rewardedCount + qualifiedCount;
        const earnedBlocks = Math.floor(totalQualified / REFERRALS_PER_REWARD);
        const claimedBlocks = Math.floor(rewardedCount / REFERRALS_PER_REWARD);
        const unclaimedBlocks = earnedBlocks - claimedBlocks;

        if (unclaimedBlocks <= 0) {
            return res.status(400).json({
                error: 'No reward available to claim yet',
                totalQualified,
                referralsPerReward: REFERRALS_PER_REWARD,
                needMore: REFERRALS_PER_REWARD - (totalQualified % REFERRALS_PER_REWARD)
            });
        }

        const result = await awardPremiumDays(user, unclaimedBlocks * REWARD_DAYS, 'referral');

        res.json({
            success: true,
            message: `You unlocked ${unclaimedBlocks * REWARD_DAYS} days of Premium!`,
            daysAdded: unclaimedBlocks * REWARD_DAYS,
            newExpiry: result.expires,
            tier: result.tier
        });
    } catch (error) {
        console.error('Claim referral reward error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// INTERNAL — called from progress.js when a lesson completes
// ============================================
export async function qualifyReferralForUser(userId) {
    try {
        const ref = await Referral.findOne({
            referredUserId: userId,
            status: 'pending'
        });

        if (!ref) return { qualified: false };

        ref.status = 'qualified';
        ref.completedFirstLessonAt = new Date();
        await ref.save();

        await User.findByIdAndUpdate(ref.referrerId, {
            $inc: { pendingReferrals: -1, referralCount: 1 }
        });

        // Notify the referrer
        const referred = await User.findById(userId).select('fullName username avatarUrl');
        await Notification.create({
            userId: ref.referrerId,
            type: 'referral_qualified',
            sourceId: userId,
            sourceUsername: referred?.username || 'User',
            sourceAvatar: referred?.avatarUrl || '',
            content: `${referred?.fullName || 'Someone'} completed their first lesson! +1 referral counted.`
        });

        // Auto-claim if a block is complete
        const rewardedCount = await Referral.countDocuments({
            referrerId: ref.referrerId,
            status: 'rewarded'
        });
        const qualifiedCount = await Referral.countDocuments({
            referrerId: ref.referrerId,
            status: 'qualified'
        });

        const totalQualified = rewardedCount + qualifiedCount;
        const earnedBlocks = Math.floor(totalQualified / REFERRALS_PER_REWARD);
        const claimedBlocks = Math.floor(rewardedCount / REFERRALS_PER_REWARD);
        const unclaimed = earnedBlocks - claimedBlocks;

        if (unclaimed > 0) {
            const referrer = await User.findById(ref.referrerId);
            if (referrer) {
                await awardPremiumDays(referrer, unclaimed * REWARD_DAYS, 'referral');

                // Mark `unclaimed * REFERRALS_PER_REWARD` referrals as rewarded
                const toMark = await Referral.find({
                    referrerId: ref.referrerId,
                    status: 'qualified'
                }).sort({ completedFirstLessonAt: 1 }).limit(unclaimed * REFERRALS_PER_REWARD);

                for (const r of toMark) {
                    r.status = 'rewarded';
                    r.rewardedAt = new Date();
                    r.rewardDays = REWARD_DAYS / REFERRALS_PER_REWARD;
                    await r.save();
                }

                await User.findByIdAndUpdate(ref.referrerId, {
                    $inc: { referralsRewarded: unclaimed }
                });
            }
        }

        return { qualified: true, autoRewarded: unclaimed > 0 };
    } catch (error) {
        console.error('Qualify referral error:', error);
        return { qualified: false, error: error.message };
    }
}

// ============================================
// HELPER — extend or set subscription
// ============================================
async function awardPremiumDays(user, days, source) {
    const now = new Date();
    const currentExpiry = user.subscriptionExpires ? new Date(user.subscriptionExpires) : null;

    // Start from the later of (now, current expiry)
    const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(base);
    newExpiry.setDate(newExpiry.getDate() + days);

    // Only bump tier to 'premium' if user was free or already premium
    // (never downgrade an immersive user)
    const newTier = user.subscriptionTier === 'immersive' ? 'immersive' : 'premium';

    const updated = await User.findByIdAndUpdate(
        user._id,
        {
            subscriptionTier: newTier,
            subscriptionExpires: newExpiry
        },
        { new: true }
    );

    // Record in Subscription history
    await Subscription.create({
        userId: user._id,
        tier: newTier,
        provider: 'referral',
        status: 'active',
        startDate: base,
        endDate: newExpiry,
        amountPaid: 0,
        currency: 'NGN',
        paymentMethod: source
    });

    // Notify
    await Notification.create({
        userId: user._id,
        type: 'subscription_activated',
        content: `🎉 You earned ${days} days of Premium from referrals!`
    });

    return { tier: updated.subscriptionTier, expires: updated.subscriptionExpires };
}

export default router;