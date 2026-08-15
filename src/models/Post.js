const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorUsername: { type: String, required: true },
    authorAvatar: { type: String, default: '' },
    authorName: { type: String, required: true },
    content: {
        text: { type: String, maxlength: 5000, required: true },
        media: [{
            type: { type: String, enum: ['image', 'video', 'audio'] },
            url: String,
            caption: String
        }]
    },
    type: {
        type: String,
        enum: ['post', 'achievement', 'question', 'challenge', 'tip'],
        default: 'post'
    },
    achievement: {
        id: String,
        name: String,
        icon: String,
        description: String
    },
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isPinned: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    language: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    deletedAt: { type: Date, default: null }
});

module.exports = mongoose.model('Post', PostSchema);