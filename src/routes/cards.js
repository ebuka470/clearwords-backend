import express from 'express';
import ProgressCard from '../models/ProgressCard.js';
import User from '../models/User.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/cards
 * Create a progress card
 */
router.post('/', authenticateUser, async (req, res) => {
    const { language, cardType, stats, caption } = req.body;

    if (!language || !cardType || !stats) {
        return res.status(400).json({ error: 'language, cardType, stats are required' });
    }

    try {
        const user = await User.findById(req.userId);

        const card = await ProgressCard.create({
            userId: user._id,
            username: user.username || user.email.split('@')[0],
            avatarUrl: user.avatarUrl || '',
            language,
            cardType,
            stats,
            caption: caption || ''
        });

        user.cardsShared = (user.cardsShared || 0) + 1;
        await user.save();

        res.status(201).json(card);
    } catch (error) {
        console.error('Create card error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/cards/mine
 */
router.get('/mine', authenticateUser, async (req, res) => {
    try {
        const cards = await ProgressCard.find({ userId: req.userId })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json({ data: cards });
    } catch (error) {
        console.error('Get cards error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/cards/:cardId/share/pod/:podId
 * Share a card inside a pod
 */
router.post('/:cardId/share/pod/:podId', authenticateUser, async (req, res) => {
    const { cardId, podId } = req.params;

    try {
        const card = await ProgressCard.findOne({ _id: cardId, userId: req.userId });
        if (!card) return res.status(404).json({ error: 'Card not found' });

        if (!card.sharedInternally.some(id => id.toString() === podId)) {
            card.sharedInternally.push(podId);
            await card.save();
        }

        res.json({ success: true, card });
    } catch (error) {
        console.error('Share card error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/cards/:cardId/share/external
 */
router.post('/:cardId/share/external', authenticateUser, async (req, res) => {
    const { cardId } = req.params;

    try {
        const card = await ProgressCard.findOne({ _id: cardId, userId: req.userId });
        if (!card) return res.status(404).json({ error: 'Card not found' });

        card.sharedExternally = true;
        await card.save();

        res.json({ success: true, card });
    } catch (error) {
        console.error('Share external error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;