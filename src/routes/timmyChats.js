import express from 'express';
import mongoose from 'mongoose';
import TimmyChat from '../models/TimmyChat.js';
import { authenticateUser } from '../middleware/auth.js';
import { resolveProfile } from '../middleware/profile.js';

const router = express.Router();

const MAX_MESSAGES_PER_CHAT = 300;
const MAX_CHATS_PER_SECTION = 100;
const MAX_TITLE_LENGTH = 120;
const VALID_SECTIONS = [
    'practice', 'cultural', 'quick',
    'greeting_parent', 'meeting_friend', 'market',
    'meal_sharing', 'directions', 'showing_respect'
];

/* ============================================================
   HELPERS
   ============================================================ */
function isValidSection(sectionId) {
    return VALID_SECTIONS.includes(String(sectionId || '').trim());
}

function cleanTitle(raw, fallback = 'New chat') {
    const t = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!t) return fallback;
    return t.length > MAX_TITLE_LENGTH ? t.slice(0, MAX_TITLE_LENGTH) + '…' : t;
}

function deriveTitleFromMessages(messages, fallback) {
    const firstUser = (messages || []).find(m => m.role === 'user' && m.content && !m.isError);
    if (firstUser) return cleanTitle(firstUser.content, fallback);
    return cleanTitle(fallback, 'New chat');
}

function publicChat(doc) {
    return {
        chatId: doc.chatId,
        sectionId: doc.sectionId,
        language: doc.language,
        title: doc.title,
        unreadCount: doc.unreadCount || 0,
        lastReadAt: doc.lastReadAt,
        lastMessageAt: doc.lastMessageAt,
        messageCount: doc.messageCount || 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        lastMessage: doc.messages.length
            ? {
                role: doc.messages[doc.messages.length - 1].role,
                content: String(doc.messages[doc.messages.length - 1].content || '').slice(0, 200),
                ts: doc.messages[doc.messages.length - 1].ts
            }
            : null
    };
}

/* ============================================================
   GET /api/timmy-chats/sections
   ============================================================ */
router.get('/sections', authenticateUser, resolveProfile, async (req, res) => {
    try {
        const language = String(req.query.language || '').trim().toLowerCase();

        const match = { userId: req.userId, profileId: req.profileId || null };
        if (language) match.language = language;

        const agg = await TimmyChat.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$sectionId',
                    totalChats: { $sum: 1 },
                    unreadChats: {
                        $sum: { $cond: [{ $gt: ['$unreadCount', 0] }, 1, 0] }
                    },
                    totalUnread: { $sum: '$unreadCount' },
                    latestMessageAt: { $max: '$lastMessageAt' }
                }
            }
        ]);

        const out = {};
        let totalUnread = 0;
        for (const row of agg) {
            out[row._id] = {
                totalChats: row.totalChats,
                unreadChats: row.unreadChats,
                totalUnread: row.totalUnread,
                latestMessageAt: row.latestMessageAt
            };
            totalUnread += row.totalUnread;
        }

        res.json({ sections: out, totalUnread });
    } catch (error) {
        console.error('Timmy sections summary error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   GET /api/timmy-chats
   ============================================================ */
router.get('/', authenticateUser, resolveProfile, async (req, res) => {
    const sectionId = String(req.query.section || '').trim();
    const language = String(req.query.language || '').trim().toLowerCase();

    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid or missing section' });
    }

    try {
        const query = { userId: req.userId, profileId: req.profileId || null, sectionId };
        if (language) query.language = language;

        const chats = await TimmyChat.find(query)
            .sort({ lastMessageAt: -1, updatedAt: -1 })
            .limit(MAX_CHATS_PER_SECTION);

        res.json({
            sectionId,
            language: language || null,
            chats: chats.map(publicChat)
        });
    } catch (error) {
        console.error('List Timmy chats error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/timmy-chats
   ============================================================ */
router.post('/', authenticateUser, resolveProfile, async (req, res) => {
    const {
        sectionId,
        language,
        chatId: clientChatId,
        title,
        greeting
    } = req.body || {};

    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid or missing sectionId' });
    }
    if (!language || typeof language !== 'string') {
        return res.status(400).json({ error: 'language is required' });
    }

    try {
        const profileScope = { profileId: req.profileId || null };

        const existingCount = await TimmyChat.countDocuments({
            userId: req.userId,
            ...profileScope,
            sectionId,
            language
        });
        if (existingCount >= MAX_CHATS_PER_SECTION) {
            return res.status(429).json({
                error: `Too many chats in this section (max ${MAX_CHATS_PER_SECTION}). Delete some first.`
            });
        }

        const chatId = String(clientChatId || '').trim()
            || ('chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));

        let existing = await TimmyChat.findOne({
            userId: req.userId,
            ...profileScope,
            sectionId,
            chatId
        });
        if (existing) {
            return res.status(200).json({ chat: { ...publicChat(existing), messages: existing.messages } });
        }

        const initialMessages = [];
        if (greeting && typeof greeting === 'string' && greeting.trim()) {
            initialMessages.push({
                role: 'assistant',
                content: greeting.slice(0, 8000),
                ts: new Date()
            });
        }

        const doc = await TimmyChat.create({
            userId: req.userId,
            ...profileScope,
            sectionId,
            chatId,
            language: String(language).toLowerCase(),
            title: cleanTitle(title, deriveTitleFromMessages(initialMessages, 'New chat')),
            messages: initialMessages,
            messageCount: initialMessages.length,
            lastMessageAt: initialMessages.length
                ? initialMessages[initialMessages.length - 1].ts
                : null
        });

        res.status(201).json({ chat: { ...publicChat(doc), messages: doc.messages } });
    } catch (error) {
        console.error('Create Timmy chat error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   GET /api/timmy-chats/:sectionId/:chatId
   ============================================================ */
router.get('/:sectionId/:chatId', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId, chatId } = req.params;

    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }

    try {
        const doc = await TimmyChat.findOne({
            userId: req.userId,
            profileId: req.profileId || null,
            sectionId,
            chatId: String(chatId)
        });
        if (!doc) return res.status(404).json({ error: 'Chat not found' });

        res.json({ chat: { ...publicChat(doc), messages: doc.messages } });
    } catch (error) {
        console.error('Get Timmy chat error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/timmy-chats/:sectionId/:chatId/message
   ============================================================ */
router.post('/:sectionId/:chatId/message', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId, chatId } = req.params;
    const { role, content, isError } = req.body || {};

    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }
    if (!role || !['user', 'assistant'].includes(role)) {
        return res.status(400).json({ error: 'role must be "user" or "assistant"' });
    }
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required' });
    }
    if (content.length > 8000) {
        return res.status(400).json({ error: 'content too long (max 8000 chars)' });
    }

    try {
        const msg = { role, content, isError: !!isError, ts: new Date() };

        const doc = await TimmyChat.findOneAndUpdate(
            {
                userId: req.userId,
                profileId: req.profileId || null,
                sectionId,
                chatId: String(chatId)
            },
            {
                $push: { messages: msg },
                $set: { lastMessageAt: msg.ts },
                $inc: {
                    messageCount: 1,
                    unreadCount: role === 'assistant' ? 1 : 0
                }
            },
            { new: true }
        );

        if (!doc) return res.status(404).json({ error: 'Chat not found' });

        if (doc.messages.length > MAX_MESSAGES_PER_CHAT) {
            doc.messages = doc.messages.slice(-MAX_MESSAGES_PER_CHAT);
            doc.messageCount = doc.messages.length;
        }

        if (doc.title === 'New chat' || !doc.title) {
            doc.title = deriveTitleFromMessages(doc.messages, doc.title || 'New chat');
        }

        await doc.save();

        const saved = doc.messages[doc.messages.length - 1];
        res.status(201).json({
            success: true,
            message: saved,
            messageCount: doc.messageCount,
            title: doc.title
        });
    } catch (error) {
        console.error('Append Timmy chat message error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/timmy-chats/:sectionId/:chatId/read
   ============================================================ */
router.post('/:sectionId/:chatId/read', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId, chatId } = req.params;
    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }

    try {
        const doc = await TimmyChat.findOneAndUpdate(
            {
                userId: req.userId,
                profileId: req.profileId || null,
                sectionId,
                chatId: String(chatId)
            },
            { $set: { unreadCount: 0, lastReadAt: new Date() } },
            { new: true }
        );
        if (!doc) return res.status(404).json({ error: 'Chat not found' });
        res.json({ success: true, lastReadAt: doc.lastReadAt });
    } catch (error) {
        console.error('Mark Timmy chat read error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/timmy-chats/:sectionId/read-all
   ============================================================ */
router.post('/:sectionId/read-all', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId } = req.params;
    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }

    try {
        const result = await TimmyChat.updateMany(
            {
                userId: req.userId,
                profileId: req.profileId || null,
                sectionId,
                unreadCount: { $gt: 0 }
            },
            { $set: { unreadCount: 0, lastReadAt: new Date() } }
        );
        res.json({ success: true, modified: result.modifiedCount });
    } catch (error) {
        console.error('Mark Timmy section read error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   PATCH /api/timmy-chats/:sectionId/:chatId
   ============================================================ */
router.patch('/:sectionId/:chatId', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId, chatId } = req.params;
    const { title } = req.body || {};
    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }
    if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: 'title is required' });
    }

    try {
        const doc = await TimmyChat.findOneAndUpdate(
            {
                userId: req.userId,
                profileId: req.profileId || null,
                sectionId,
                chatId: String(chatId)
            },
            { $set: { title: cleanTitle(title) } },
            { new: true }
        );
        if (!doc) return res.status(404).json({ error: 'Chat not found' });
        res.json({ success: true, chat: publicChat(doc) });
    } catch (error) {
        console.error('Rename Timmy chat error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   DELETE /api/timmy-chats/section/:sectionId
   ============================================================ */
router.delete('/section/:sectionId', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId } = req.params;
    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }

    try {
        const result = await TimmyChat.deleteMany({
            userId: req.userId,
            profileId: req.profileId || null,
            sectionId
        });
        res.json({ success: true, deleted: result.deletedCount });
    } catch (error) {
        console.error('Clear Timmy section error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   DELETE /api/timmy-chats/:sectionId/:chatId
   ============================================================ */
router.delete('/:sectionId/:chatId', authenticateUser, resolveProfile, async (req, res) => {
    const { sectionId, chatId } = req.params;
    if (!isValidSection(sectionId)) {
        return res.status(400).json({ error: 'Invalid section' });
    }

    try {
        const result = await TimmyChat.findOneAndDelete({
            userId: req.userId,
            profileId: req.profileId || null,
            sectionId,
            chatId: String(chatId)
        });
        if (!result) return res.status(404).json({ error: 'Chat not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete Timmy chat error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/timmy-chats/import
   ============================================================ */
router.post('/import', authenticateUser, resolveProfile, async (req, res) => {
    const { language, threads } = req.body || {};
    if (!language || !Array.isArray(threads)) {
        return res.status(400).json({ error: 'language and threads[] are required' });
    }

    try {
        let imported = 0;
        let skipped = 0;
        const profileScope = { profileId: req.profileId || null };

        for (const t of threads) {
            if (!t || !isValidSection(t.sectionId) || !t.chatId) { skipped++; continue; }

            const existing = await TimmyChat.findOne({
                userId: req.userId,
                ...profileScope,
                sectionId: t.sectionId,
                chatId: String(t.chatId)
            });
            if (existing) { skipped++; continue; }

            const cleanedMessages = (Array.isArray(t.messages) ? t.messages : [])
                .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
                .slice(-MAX_MESSAGES_PER_CHAT)
                .map(m => ({
                    role: m.role,
                    content: String(m.content).slice(0, 8000),
                    isError: !!m.isError,
                    ts: m.ts ? new Date(m.ts) : new Date()
                }));

            if (!cleanedMessages.length) { skipped++; continue; }

            const last = cleanedMessages[cleanedMessages.length - 1];
            await TimmyChat.create({
                userId: req.userId,
                ...profileScope,
                sectionId: t.sectionId,
                chatId: String(t.chatId),
                language: String(language).toLowerCase(),
                title: cleanTitle(t.title, deriveTitleFromMessages(cleanedMessages, 'New chat')),
                messages: cleanedMessages,
                messageCount: cleanedMessages.length,
                lastMessageAt: last.ts,
                unreadCount: 0
            });
            imported++;
        }

        res.json({ success: true, imported, skipped });
    } catch (error) {
        console.error('Import Timmy chats error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;