const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
        type: String,
        enum: ['like', 'comment', 'reply', 'follow', 'mention', 'achievement', 'challenge', 'streak', 'subscription', 'community_challenge']
    },
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sourceUsername: { type: String, required: true },
    sourceAvatar: { type: String, default: '' },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    targetType: { type: String },
    content: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    isClicked: { type: Boolean, default: false },
    data: {
        postId: { type: mongoose.Schema.Types.ObjectId },
        commentId: { type: mongoose.Schema.Types.ObjectId },
        postText: String,
        commentText: String
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);