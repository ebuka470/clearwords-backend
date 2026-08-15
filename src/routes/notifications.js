const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/notifications
 * Get user notifications
 */
router.get('/', authenticateUser, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    try {
        const skip = (page - 1) * limit;
        const notifications = await Notification.find({ userId: req.userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Notification.countDocuments({ userId: req.userId });

        res.json({
            data: notifications,
            total,
            page,
            limit,
            hasMore: skip + notifications.length < total
        });

    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/notifications/unread
 * Get unread count
 */
router.get('/unread', authenticateUser, async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            userId: req.userId,
            isRead: false
        });

        res.json({ count });

    } catch (error) {
        console.error('Unread count error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/notifications/:notificationId/read
 * Mark notification as read
 */
router.put('/:notificationId/read', authenticateUser, async (req, res) => {
    const { notificationId } = req.params;

    try {
        const notification = await Notification.findOne({
            _id: notificationId,
            userId: req.userId
        });

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        notification.isRead = true;
        await notification.save();

        res.json({ success: true });

    } catch (error) {
        console.error('Mark read error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put('/read-all', authenticateUser, async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.userId, isRead: false },
            { isRead: true }
        );

        res.json({ success: true });

    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/notifications/:notificationId
 * Delete a notification
 */
router.delete('/:notificationId', authenticateUser, async (req, res) => {
    const { notificationId } = req.params;

    try {
        const result = await Notification.findOneAndDelete({
            _id: notificationId,
            userId: req.userId
        });

        if (!result) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;