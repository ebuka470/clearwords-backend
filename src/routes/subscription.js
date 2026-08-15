const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/subscription
 * Get user's subscription status
 */
router.get('/', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const isExpired = user.subscriptionExpires && new Date(user.subscriptionExpires) < new Date();

        res.json({
            tier: isExpired ? 'free' : (user.subscriptionTier || 'free'),
            expires: user.subscriptionExpires,
            isExpired: isExpired || false,
            isActive: !isExpired && user.subscriptionTier !== 'free'
        });

    } catch (error) {
        console.error('Subscription error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/subscription/update
 * Update subscription (webhook will call this)
 */
router.post('/update', async (req, res) => {
    // TODO: Add webhook secret verification
    const { userId, tier, expires, customerCode, subscriptionId } = req.body;

    if (!userId || !tier) {
        return res.status(400).json({ error: 'userId and tier are required' });
    }

    try {
        const user = await User.findByIdAndUpdate(
            userId,
            {
                subscriptionTier: tier,
                subscriptionExpires: expires || null,
                paystackCustomerCode: customerCode || null
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await Subscription.create({
            userId: userId,
            tier: tier,
            provider: 'paystack',
            providerSubscriptionId: subscriptionId || null,
            providerCustomerId: customerCode || null,
            status: 'active',
            startDate: new Date(),
            endDate: expires || null
        });

        res.json({
            success: true,
            message: 'Subscription updated',
            user: {
                id: user._id,
                subscriptionTier: user.subscriptionTier,
                subscriptionExpires: user.subscriptionExpires
            }
        });

    } catch (error) {
        console.error('Update subscription error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;