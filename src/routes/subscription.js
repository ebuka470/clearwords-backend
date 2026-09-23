import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';
import { TIER_LIMITS, getUserLimits } from '../middleware/tierGate.js';

const router = express.Router();

// ============================================
// CONFIG
// ============================================

const TIER_PRICES = {
    // Amounts in kobo (Paystack uses smallest currency unit)
    premium: {
        NGN: { monthly: 250000, yearly: 2500000 },   // ₦2,500 / ₦25,000
        USD: { monthly: 500,    yearly: 5000 }        // $5 / $50 (cents)
    },
    immersive: {
        NGN: { monthly: 500000, yearly: 5000000 },   // ₦5,000 / ₦50,000
        USD: { monthly: 1000,   yearly: 10000 }       // $10 / $100
    }
};

const TIER_DURATION_DAYS = {
    monthly: 30,
    yearly: 365
};

// ============================================
// GET /api/subscription
// ============================================
router.get('/', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isExpired = user.subscriptionExpires && new Date(user.subscriptionExpires) < new Date();
        const limits = getUserLimits(user);

        res.json({
            tier: isExpired ? 'free' : (user.subscriptionTier || 'free'),
            expires: user.subscriptionExpires,
            isExpired: isExpired || false,
            isActive: !isExpired && user.subscriptionTier !== 'free',
            limits,
            currency: user.currency || 'NGN'
        });
    } catch (error) {
        console.error('Subscription error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// GET /api/subscription/plans
// Public — returns tier comparison + prices
// ============================================
router.get('/plans', (req, res) => {
    res.json({
        free: {
            ...TIER_LIMITS.free,
            prices: null
        },
        premium: {
            ...TIER_LIMITS.premium,
            prices: TIER_PRICES.premium
        },
        immersive: {
            ...TIER_LIMITS.immersive,
            prices: TIER_PRICES.immersive
        }
    });
});

// ============================================
// POST /api/subscription/initialize
// Called by the frontend before opening Paystack popup
// Returns the reference + amount to charge
// ============================================
router.post('/initialize', authenticateUser, async (req, res) => {
    const { tier, billingCycle = 'monthly', currency = 'NGN' } = req.body;

    if (!tier || !['premium', 'immersive'].includes(tier)) {
        return res.status(400).json({ error: 'tier must be premium or immersive' });
    }

    if (!['monthly', 'yearly'].includes(billingCycle)) {
        return res.status(400).json({ error: 'billingCycle must be monthly or yearly' });
    }

    if (!['NGN', 'USD'].includes(currency)) {
        return res.status(400).json({ error: 'currency must be NGN or USD' });
    }

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const price = TIER_PRICES[tier][currency][billingCycle];
        const reference = `CW-${tier}-${req.userId}-${Date.now()}`;

        res.json({
            reference,
            amount: price,
            currency,
            tier,
            billingCycle,
            email: user.email,
            publicKey: process.env.PAYSTACK_PUBLIC_KEY,
            metadata: {
                userId: req.userId.toString(),
                tier,
                billingCycle,
                currency
            }
        });
    } catch (error) {
        console.error('Initialize subscription error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// POST /api/subscription/verify/:reference
// Called by the frontend after Paystack succeeds
// Confirms the payment and activates the tier
// ============================================
router.post('/verify/:reference', authenticateUser, async (req, res) => {
    const { reference } = req.params;
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret) {
        return res.status(500).json({ error: 'Paystack not configured' });
    }

    try {
        const response = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${secret}`
                }
            }
        );

        const data = await response.json();

        if (!response.ok || !data.status) {
            return res.status(400).json({
                error: 'Verification failed',
                detail: data.message
            });
        }

        const tx = data.data;

        if (tx.status !== 'success') {
            return res.status(400).json({ error: 'Payment not successful', status: tx.status });
        }

        const { userId, tier, billingCycle } = tx.metadata || {};

        if (userId !== req.userId.toString()) {
            return res.status(403).json({ error: 'Reference does not belong to you' });
        }

        if (!tier || !['premium', 'immersive'].includes(tier)) {
            return res.status(400).json({ error: 'Invalid tier in metadata' });
        }

        // Idempotency: if we already recorded this reference, just return
        const existing = await Subscription.findOne({ providerSubscriptionId: reference });
        if (existing && existing.status === 'active') {
            const user = await User.findById(userId);
            return res.json({
                success: true,
                alreadyActivated: true,
                tier: user.subscriptionTier,
                expires: user.subscriptionExpires
            });
        }

        const days = TIER_DURATION_DAYS[billingCycle || 'monthly'];
        const expires = new Date();
        expires.setDate(expires.getDate() + days);

        // Activate on user
        const user = await User.findByIdAndUpdate(
            userId,
            {
                subscriptionTier: tier,
                subscriptionExpires: expires,
                paystackCustomerCode: tx.customer?.customer_code || null
            },
            { new: true }
        );

        // Record subscription
        await Subscription.create({
            userId,
            tier,
            provider: 'paystack',
            providerSubscriptionId: reference,
            providerCustomerId: tx.customer?.customer_code || null,
            status: 'active',
            startDate: new Date(),
            endDate: expires,
            amountPaid: tx.amount / 100,
            currency: tx.currency || 'NGN',
            paymentMethod: tx.channel || null
        });

        // Notify
        await Notification.create({
            userId,
            type: 'subscription_activated',
            content: `🎉 Your ${tier} subscription is now active until ${expires.toDateString()}`
        });

        res.json({
            success: true,
            tier: user.subscriptionTier,
            expires: user.subscriptionExpires
        });
    } catch (error) {
        console.error('Verify subscription error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// POST /api/subscription/update
// Admin override (keep for internal use only)
// ============================================
router.post('/update', async (req, res) => {
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

        if (!user) return res.status(404).json({ error: 'User not found' });

        await Subscription.create({
            userId,
            tier,
            provider: 'paystack',
            providerSubscriptionId: subscriptionId || null,
            providerCustomerId: customerCode || null,
            status: 'active',
            startDate: new Date(),
            endDate: expires || null
        });

        res.json({ success: true, user: { id: user._id, subscriptionTier: user.subscriptionTier } });
    } catch (error) {
        console.error('Update subscription error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// POST /api/subscription/webhook
// Paystack webhook — must receive RAW body
// (see index.js for the correct mounting order)
// ============================================
export async function paystackWebhookHandler(req, res) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
        console.error('PAYSTACK_SECRET_KEY not set');
        return res.status(500).send('Webhook not configured');
    }

    // Verify signature using the raw body
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const hash = crypto
        .createHmac('sha512', secret)
        .update(rawBody)
        .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        console.warn('Invalid Paystack webhook signature');
        return res.sendStatus(401);
    }

    const event = req.body;

    try {
        switch (event.event) {
            case 'charge.success': {
                const { customer, metadata, amount, reference, currency, channel } = event.data;
                const userId = metadata?.userId;
                const tier = metadata?.tier;
                const billingCycle = metadata?.billingCycle || 'monthly';

                if (!userId || !tier) {
                    console.warn('Webhook missing userId or tier in metadata');
                    break;
                }

                // Idempotency
                const existing = await Subscription.findOne({ providerSubscriptionId: reference });
                if (existing && existing.status === 'active') {
                    console.log(`Webhook: reference ${reference} already processed`);
                    break;
                }

                const days = TIER_DURATION_DAYS[billingCycle];
                const expires = new Date();
                expires.setDate(expires.getDate() + days);

                await User.findByIdAndUpdate(userId, {
                    subscriptionTier: tier,
                    subscriptionExpires: expires,
                    paystackCustomerCode: customer?.customer_code || null
                });

                await Subscription.create({
                    userId,
                    tier,
                    provider: 'paystack',
                    providerSubscriptionId: reference,
                    providerCustomerId: customer?.customer_code || null,
                    status: 'active',
                    startDate: new Date(),
                    endDate: expires,
                    amountPaid: amount / 100,
                    currency: currency || 'NGN',
                    paymentMethod: channel || null
                });

                await Notification.create({
                    userId,
                    type: 'subscription_activated',
                    content: `🎉 Your ${tier} subscription is now active until ${expires.toDateString()}`
                });

                console.log(`✅ Webhook: activated ${tier} for user ${userId}`);
                break;
            }

            case 'subscription.disable':
            case 'subscription.not_renew': {
                const customerCode = event.data?.customer?.customer_code;
                if (!customerCode) break;

                const user = await User.findOneAndUpdate(
                    { paystackCustomerCode: customerCode },
                    { subscriptionTier: 'free', subscriptionExpires: null },
                    { new: true }
                );

                if (user) {
                    await Notification.create({
                        userId: user._id,
                        type: 'subscription_ended',
                        content: '⏸️ Your subscription has ended. You are now on the free tier.'
                    });
                }

                console.log(`⏸️ Webhook: subscription disabled for customer ${customerCode}`);
                break;
            }

            default:
                console.log(`Unhandled Paystack event: ${event.event}`);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Paystack webhook error:', error);
        res.sendStatus(500);
    }
}

export default router;