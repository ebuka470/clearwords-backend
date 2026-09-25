import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import axios from 'axios';
import dotenv from 'dotenv';

import { connectDB } from './config/mongodb.js';

// Routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import progressRoutes from './routes/progress.js';
import podRoutes from './routes/pods.js';
import pairRoutes from './routes/pairs.js';
import cardRoutes from './routes/cards.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import subscriptionRoutes, { paystackWebhookHandler } from './routes/subscription.js';
import curriculumRoutes from './routes/curriculum.js';
import ttsRouter from './routes/tts.js';
import aiRoutes from './routes/ai.js';
import referralRoutes from './routes/referrals.js';
import streakRoutes from './routes/streak.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Background jobs
import { startPairDissolver } from './jobs/pairDissolver.js';
import { startWeeklyStreakJob } from './jobs/weeklyStreak.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

connectDB();

// ============================================
// PAYSTACK WEBHOOK — must come BEFORE express.json()
// Paystack signs the raw body, so we capture it here.
// ============================================
app.post(
    '/api/subscription/webhook',
    express.raw({ type: 'application/json' }),
    (req, res, next) => {
        try {
            req.rawBody = req.body.toString('utf8');
            req.body = JSON.parse(req.rawBody);
        } catch (err) {
            console.error('Webhook body parse error:', err.message);
            return res.status(400).send('Invalid JSON');
        }
        next();
    },
    paystackWebhookHandler
);

// ============================================
// SECURITY
// ============================================
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// ============================================
// CORS
// ============================================
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const allowedOrigins = [
            'https://clearwords.vercel.app',
            'https://clearwords-versions.vercel.app',
            'https://clearwords.com.ng',
            'https://www.clearwords.com.ng',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:8081',
            'http://localhost:19006'
        ];
        if (allowedOrigins.includes(origin)) return callback(null, true);
        console.log('Blocked CORS origin:', origin);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400
}));

app.options('*', cors());

// ============================================
// GENERAL MIDDLEWARE (after webhook!)
// ============================================
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// HEALTH
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'clearwords-backend',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        database: 'MongoDB Atlas',
        jobs: {
            pairDissolver: 'running',
            weeklyStreak: 'running'
        },
        payments: {
            paystackConfigured: !!process.env.PAYSTACK_SECRET_KEY
        },
        ai: {
            mistralConfigured: !!process.env.MISTRAL_API_KEY
        },
        features: {
            referrals: true,
            streakFreeze: true,
            lessonCompletion: true,
            cardRendering: true
        }
    });
});

// ============================================
// TTS
// ============================================
app.use('/clearwordsapi', ttsRouter);

// ============================================
// API ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/pods', podRoutes);
app.use('/api/pairs', pairRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscription', subscriptionRoutes); // webhook already mounted above
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/tts', ttsRouter);
app.use('/api/ai', aiRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/streak', streakRoutes);
app.use('/public', express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    immutable: false
}));

// ============================================
// 404
// ============================================
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ============================================
// BACKGROUND JOBS
// ============================================
startPairDissolver();
startWeeklyStreakJob();

// Keep-alive
const keepAliveUrl = 'https://clearwords-backend.onrender.com/';
setInterval(() => {
    axios.get(keepAliveUrl)
        .then(r => console.log(`💓 Keep-alive ${r.status}`))
        .catch(e => console.error(`💔 Keep-alive failed: ${e.message}`));
}, 30000);

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log('🚀 ClearWords Backend v3.0 — Community Model');
    console.log(`📍 Running on port ${PORT}`);
    console.log(`📊 Health: /health`);
    console.log(`🫂 Pods: /api/pods`);
    console.log(`🤝 Pairs: /api/pairs`);
    console.log(`🎴 Cards: /api/cards`);
    console.log(`💰 Subscription: /api/subscription`);
    console.log(`🎤 TTS: /clearwordsapi/tts`);
    console.log(`💳 Paystack webhook: /api/subscription/webhook`);
    console.log(`🤖 AI: /api/ai/custom-lesson`);
    console.log(`👥 Referrals: /api/referrals`);
    console.log(`🔥 Streak: /api/streak`);
    console.log(`🖼️  Cards: /public/cards/*`);
});