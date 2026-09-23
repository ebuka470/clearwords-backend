import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import axios from 'axios';
import dotenv from 'dotenv';

import { connectDB } from './config/mongodb.js';

// ============================================
// ROUTES
// ============================================

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import progressRoutes from './routes/progress.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import followRoutes from './routes/follow.js';
import notificationRoutes from './routes/notifications.js';
import subscriptionRoutes from './routes/subscription.js';
import curriculumRoutes from './routes/curriculum.js';
import ttsRouter from './routes/tts.js';

// ============================================
// ENV
// ============================================

dotenv.config();

// ============================================
// APP INITIALIZATION
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONNECT DATABASE
// ============================================

connectDB();

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
        // Allow requests without an Origin header
        // such as server-to-server requests
        if (!origin) {
            return callback(null, true);
        }

        const allowedOrigins = [
            'https://clearwords.com.ng',
            'https://www.clearwords.com.ng',
            'https://clearwords.vercel.app',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:8081',
            'http://localhost:19006'
        ];

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.log('Blocked CORS origin:', origin);

        return callback(new Error('Not allowed by CORS'));
    },

    credentials: true,

    methods: [
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'OPTIONS'
    ],

    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With'
    ],

    maxAge: 86400
}));

// Explicitly handle OPTIONS preflight requests
app.options('*', cors());

// ============================================
// GENERAL MIDDLEWARE
// ============================================

app.use(compression());

app.use(morgan('dev'));

app.use(express.json({
    limit: '10mb'
}));

app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

app.set('trust proxy', 1);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'clearwords-backend',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        database: 'MongoDB Atlas'
    });
});

// ============================================
// CLEARWORDS TTS ROUTE
// ============================================

// This gives:
// POST /clearwordsapi/tts
// GET  /clearwordsapi/tts/credits

app.use('/clearwordsapi', ttsRouter);

// ============================================
// OTHER API ROUTES
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.get('/', (req, res) => res.json({ status: 'ok' }));
// Use the same ttsRouter variable
app.use('/api/tts', ttsRouter);

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
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log('🚀 ClearWords Backend v2.0');
    console.log(`📍 Running on port ${PORT}`);
    console.log(`📊 Health: /health`);
    console.log(`🎤 TTS: /clearwordsapi/tts`);
});
