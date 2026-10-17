import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true,
        maxlength: 8000
    },
    isError: {
        type: Boolean,
        default: false
    },
    ts: {
        type: Date,
        default: Date.now
    }
}, { _id: true });

const TimmyChatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    profileId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    sectionId: {
        type: String,
        required: true,
        index: true
    },
    chatId: {
        type: String,
        required: true
    },
    language: {
        type: String,
        required: true,
        index: true
    },
    title: {
        type: String,
        default: 'New chat',
        maxlength: 120
    },
    messages: {
        type: [MessageSchema],
        default: []
    },
    unreadCount: {
        type: Number,
        default: 0,
        min: 0
    },
    lastReadAt: {
        type: Date,
        default: new Date(0)
    },
    lastMessageAt: {
        type: Date,
        default: null,
        index: true
    },
    messageCount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// One document per user + profile + section + chat
TimmyChatSchema.index({ userId: 1, profileId: 1, sectionId: 1, chatId: 1 }, { unique: true });

// Fast "list chats in a section" queries
TimmyChatSchema.index({ userId: 1, profileId: 1, sectionId: 1, lastMessageAt: -1 });

const TimmyChat = mongoose.model('TimmyChat', TimmyChatSchema);
export default TimmyChat;