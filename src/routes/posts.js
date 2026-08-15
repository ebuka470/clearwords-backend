const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/posts/feed
 * Get community feed
 */
router.get('/feed', authenticateUser, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    try {
        const skip = (page - 1) * limit;
        const posts = await Post.find({ deletedAt: null })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Post.countDocuments({ deletedAt: null });

        res.json({
            data: posts,
            total,
            page,
            limit,
            hasMore: skip + posts.length < total
        });

    } catch (error) {
        console.error('Get feed error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/posts
 * Create a post
 */
router.post('/', authenticateUser, async (req, res) => {
    const { content, type, achievement, language } = req.body;

    if (!content?.text) {
        return res.status(400).json({ error: 'Post content is required' });
    }

    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const post = await Post.create({
            authorId: user._id,
            authorUsername: user.username || user.email.split('@')[0],
            authorAvatar: user.avatarUrl || '',
            authorName: user.fullName,
            content,
            type: type || 'post',
            achievement: achievement || null,
            language: language || user.language || 'yoruba'
        });

        user.postsCount += 1;
        await user.save();

        res.status(201).json(post);

    } catch (error) {
        console.error('Create post error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/posts/:postId/like
 * Like a post
 */
router.post('/:postId/like', authenticateUser, async (req, res) => {
    const { postId } = req.params;

    try {
        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (post.likedBy.includes(req.userId)) {
            return res.status(400).json({ error: 'Already liked' });
        }

        post.likedBy.push(req.userId);
        post.likesCount += 1;
        await post.save();

        // Create notification if not self
        if (post.authorId.toString() !== req.userId) {
            await Notification.create({
                userId: post.authorId,
                type: 'like',
                sourceId: req.userId,
                sourceUsername: req.user.username || 'User',
                sourceAvatar: req.user.avatarUrl || '',
                targetId: postId,
                targetType: 'post',
                content: `${req.user.fullName || 'Someone'} liked your post`,
                data: { postId, postText: post.content.text.substring(0, 50) }
            });
        }

        res.json({ likesCount: post.likesCount, isLiked: true });

    } catch (error) {
        console.error('Like post error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/posts/:postId/like
 * Unlike a post
 */
router.delete('/:postId/like', authenticateUser, async (req, res) => {
    const { postId } = req.params;

    try {
        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        post.likedBy = post.likedBy.filter(id => id.toString() !== req.userId);
        post.likesCount = Math.max(0, post.likesCount - 1);
        await post.save();

        res.json({ likesCount: post.likesCount, isLiked: false });

    } catch (error) {
        console.error('Unlike post error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/posts/:postId
 * Delete a post
 */
router.delete('/:postId', authenticateUser, async (req, res) => {
    const { postId } = req.params;

    try {
        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        if (post.authorId.toString() !== req.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        post.deletedAt = new Date();
        await post.save();

        await User.findByIdAndUpdate(req.userId, { $inc: { postsCount: -1 } });

        res.json({ success: true, message: 'Post deleted' });

    } catch (error) {
        console.error('Delete post error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;