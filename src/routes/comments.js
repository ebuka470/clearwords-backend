const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/comments/:postId
 * Get comments for a post
 */
router.get('/:postId', async (req, res) => {
    const { postId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    try {
        const skip = (page - 1) * limit;
        const comments = await Comment.find({ postId, parentCommentId: null, isDeleted: false })
            .sort({ createdAt: 1 })
            .skip(skip)
            .limit(limit);

        const total = await Comment.countDocuments({ postId, parentCommentId: null, isDeleted: false });

        // Get replies for each comment
        for (const comment of comments) {
            const replies = await Comment.find({ parentCommentId: comment._id, isDeleted: false })
                .sort({ createdAt: 1 })
                .limit(3);
            comment._doc.replies = replies;
        }

        res.json({
            data: comments,
            total,
            page,
            limit,
            hasMore: skip + comments.length < total
        });

    } catch (error) {
        console.error('Get comments error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/comments
 * Create a comment
 */
router.post('/', authenticateUser, async (req, res) => {
    const { postId, content, parentCommentId } = req.body;

    if (!postId || !content) {
        return res.status(400).json({ error: 'Post ID and content are required' });
    }

    try {
        const user = await User.findById(req.userId);
        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const comment = await Comment.create({
            postId,
            authorId: user._id,
            authorUsername: user.username || user.email.split('@')[0],
            authorAvatar: user.avatarUrl || '',
            authorName: user.fullName,
            content,
            parentCommentId: parentCommentId || null
        });

        post.commentsCount += 1;
        await post.save();

        // Create notification
        if (post.authorId.toString() !== user._id.toString()) {
            await Notification.create({
                userId: post.authorId,
                type: parentCommentId ? 'reply' : 'comment',
                sourceId: user._id,
                sourceUsername: user.username || 'User',
                sourceAvatar: user.avatarUrl || '',
                targetId: postId,
                targetType: 'post',
                content: `${user.fullName || 'Someone'} ${parentCommentId ? 'replied to' : 'commented on'} your post`,
                data: { postId, commentId: comment._id, postText: post.content.text.substring(0, 50) }
            });
        }

        res.status(201).json(comment);

    } catch (error) {
        console.error('Create comment error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/comments/:commentId
 * Delete a comment
 */
router.delete('/:commentId', authenticateUser, async (req, res) => {
    const { commentId } = req.params;

    try {
        const comment = await Comment.findById(commentId);
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (comment.authorId.toString() !== req.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        comment.isDeleted = true;
        comment.content = '[deleted]';
        await comment.save();

        await Post.findByIdAndUpdate(comment.postId, { $inc: { commentsCount: -1 } });

        res.json({ success: true, message: 'Comment deleted' });

    } catch (error) {
        console.error('Delete comment error:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;