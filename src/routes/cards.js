import express from 'express';
import ProgressCard from '../models/ProgressCard.js';
import User from '../models/User.js';
import Pod from '../models/Pod.js';
import { authenticateUser } from '../middleware/auth.js';
import { saveCardSVG } from '../utils/cardRenderer.js';

const router = express.Router();

/**
 * POST /api/cards
 * Create a progress card (metadata only)
 */
router.post('/', authenticateUser, async (req, res) => {
    const { language, cardType, stats, caption } = req.body;

    if (!language || !cardType || !stats) {
        return res.status(400).json({ error: 'language, cardType, stats are required' });
    }

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

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
 * POST /api/cards/:cardId/render
 * Render the card as an SVG on disk
 */
router.post('/:cardId/render', authenticateUser, async (req, res) => {
    const { cardId } = req.params;

    try {
        const card = await ProgressCard.findOne({ _id: cardId, userId: req.userId });
        if (!card) return res.status(404).json({ error: 'Card not found' });

        const { imageUrl, imagePath } = await saveCardSVG({
            cardId: card._id.toString(),
            username: card.username,
            language: card.language,
            cardType: card.cardType,
            stats: card.stats,
            caption: card.caption,
            avatarUrl: card.avatarUrl
        });

        card.imageUrl = imageUrl;
        card.imagePath = imagePath;
        card.rendered = true;
        card.renderedAt = new Date();
        await card.save();

        res.json({
            success: true,
            imageUrl,
            fullUrl: `${req.protocol}://${req.get('host')}${imageUrl}`
        });
    } catch (error) {
        console.error('Render card error:', error);
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
 * Share a card inside a pod.
 * Requires the caller to be a member of that pod.
 */
router.post('/:cardId/share/pod/:podId', authenticateUser, async (req, res) => {
    const { cardId, podId } = req.params;

    try {
        const card = await ProgressCard.findOne({ _id: cardId, userId: req.userId });
        if (!card) return res.status(404).json({ error: 'Card not found' });

        // Verify pod exists and caller is a member
        const pod = await Pod.findById(podId);
        if (!pod || !pod.isActive) {
            return res.status(404).json({ error: 'Pod not found' });
        }

        const isMember = pod.members.some(m => m.userId.toString() === req.userId);
        if (!isMember) {
            return res.status(403).json({ error: 'You are not a member of this pod' });
        }

        // Only share to pods that match the card's language
        if (pod.language !== card.language) {
            return res.status(400).json({
                error: `This card is for ${card.language}, but the pod is for ${pod.language}`
            });
        }

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

        if (!card.rendered) {
            const { imageUrl, imagePath } = await saveCardSVG({
                cardId: card._id.toString(),
                username: card.username,
                language: card.language,
                cardType: card.cardType,
                stats: card.stats,
                caption: card.caption,
                avatarUrl: card.avatarUrl
            });
            card.imageUrl = imageUrl;
            card.imagePath = imagePath;
            card.rendered = true;
            card.renderedAt = new Date();
        }

        card.sharedExternally = true;
        await card.save();

        res.json({
            success: true,
            card,
            shareUrl: `${req.protocol}://${req.get('host')}${card.imageUrl}`
        });
    } catch (error) {
        console.error('Share external error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;