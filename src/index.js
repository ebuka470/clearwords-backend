import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

// Background jobs
import { startPairDissolver } from './jobs/pairDissolver.js';
import { startWeeklyStreakJob } from './jobs/weeklyStreak.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONNECT DATABASE
// ============================================
connectDB();

// ============================================
// PAYSTACK WEBHOOK
// Must be mounted BEFORE express.json() so we can capture the raw body
// for signature verification.
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
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// ============================================
// CORS
// ============================================
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests without an Origin header (server-to-server, curl, etc.)
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'https://clearwords.vercel.app',
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

// Handle preflight OPTIONS requests explicitly
app.options('*', cors());

// ============================================
// GENERAL MIDDLEWARE
// ============================================
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// STATIC FILES (for rendered progress cards)
// ============================================
app.use('/public', express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    immutable: false
}));

// ============================================
// HEALTH CHECK
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
        }
    });
});

// ============================================
// TTS PUBLIC ALIAS
// Exposes: POST /clearwordsapi/tts, GET /clearwordsapi/tts/credits
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
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/tts', ttsRouter);
app.use('/api/ai', aiRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/streak', streakRoutes);

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
    });
});

// ============================================
// BACKGROUND JOBS
// ============================================
startPairDissolver();
startWeeklyStreakJob();

// ============================================
// KEEP-ALIVE (for Render free tier)
// ============================================
const keepAliveUrl = 'https://clearwords-backend.onrender.com/';
const KEEP_ALIVE_INTERVAL = 30 * 1000; // 30 seconds

function keepAlive() {
    axios.get(keepAliveUrl)
        .then(response => {
            console.log(`💓 Keep-alive ${response.status} @ ${new Date().toISOString()}`);
        })
        .catch(error => {
            console.error(`💔 Keep-alive failed: ${error.message}`);
        });
}

setInterval(keepAlive, KEEP_ALIVE_INTERVAL);

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log('🚀 ClearWords Backend v3.0 — Community Model');
    console.log(`📍 Running on port ${PORT}`);
    console.log(`📊 Health: /health`);
    console.log(`👤 Auth: /api/auth (config, signup, me)`);
    console.log(`👥 Users: /api/users`);
    console.log(`📈 Progress: /api/progress`);
    console.log(`🫂 Pods: /api/pods`);
    console.log(`🤝 Pairs: /api/pairs (request, match, accept)`);
    console.log(`🎴 Cards: /api/cards`);
    console.log(`🚨 Reports: /api/reports`);
    console.log(`🔔 Notifications: /api/notifications`);
    console.log(`💰 Subscription: /api/subscription`);
    console.log(`📚 Curriculum: /api/curriculum`);
    console.log(`🤖 AI: /api/ai (chat, custom-lesson, usage)`);
    console.log(`🎯 Referrals: /api/referrals`);
    console.log(`🔥 Streak: /api/streak`);
    console.log(`🎤 TTS: /clearwordsapi/tts + /api/tts`);
    console.log(`💳 Paystack webhook: /api/subscription/webhook`);
});