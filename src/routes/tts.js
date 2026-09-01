const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Mistral } = require('@mistralai/mistralai');

// ==================== 9JALINGO TTS ====================
/**
 * POST /tts/generate
 * Generate TTS audio using 9jaLingo (direct)
 */
router.post('/tts/generate', async (req, res) => {
    const {
        text,
        voice = 'yo',
        speaker = 'adaeze_yo',
        response_format = 'mp3',
        temperature = 0.95,
        top_p = 0.95,
        repetition_penalty = 1.1
    } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    if (text.length > 500) {
        return res.status(400).json({ error: 'Text too long (max 500 characters)' });
    }

    try {
        const response = await axios({
            method: 'POST',
            url: 'https://api.9jalingo.org/v1/tts',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.NINE_JALINGO_API_KEY}`
            },
            data: {
                text,
                voice,
                speaker,
                response_format,
                temperature,
                top_p,
                repetition_penalty
            },
            responseType: 'arraybuffer'
        });

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': response.data.byteLength,
            'Cache-Control': 'public, max-age=86400'
        });

        res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('TTS error:', error);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

// ==================== 9JALINGO PROXY (for CORS bypass) ====================
/**
 * POST /tts
 * Proxy TTS requests to 9jaLingo (bypasses CORS for frontend)
 */
router.post('/tts', async (req, res) => {
    try {
        const { text, voice, speaker, response_format, temperature, top_p, repetition_penalty } = req.body;

        // Validate required fields
        if (!text) {
            return res.status(400).json({ status: 'error', message: 'Missing "text" field' });
        }

        // Get 9jaLingo API key from environment variables
        const NINE_JALINGO_API_KEY = process.env.NINE_JALINGO_API_KEY;
        if (!NINE_JALINGO_API_KEY) {
            return res.status(500).json({ status: 'error', message: '9jaLingo API key not configured' });
        }

        // Build request to 9jaLingo
        const requestBody = {
            text: text,
            voice: voice || 'yo',
            response_format: response_format || 'mp3',
            temperature: temperature || 0.95,
            top_p: top_p || 0.95,
            repetition_penalty: repetition_penalty || 1.1
        };

        // Add speaker if provided
        if (speaker) {
            requestBody.speaker = speaker;
        }

        console.log('🎤 9jaLingo request:', { text: text.substring(0, 50) + '...', voice: requestBody.voice });

        // Call 9jaLingo API
        const response = await fetch('https://api.9jalingo.org/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': NINE_JALINGO_API_KEY
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('9jaLingo error:', response.status, errorText);
            return res.status(response.status).json({
                status: 'error',
                message: `9jaLingo API error: ${response.status}`,
                detail: errorText
            });
        }

        // Get audio as buffer
        const audioBuffer = await response.arrayBuffer();

        // Return audio with proper headers
        const contentType = response_format === 'mp3' ? 'audio/mpeg' :
                           response_format === 'wav' ? 'audio/wav' :
                           response_format === 'flac' ? 'audio/flac' :
                           'audio/mpeg';

        res.set({
            'Content-Type': contentType,
            'Content-Length': audioBuffer.byteLength,
            'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
        });

        res.send(Buffer.from(audioBuffer));

    } catch (error) {
        console.error('9jaLingo proxy error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==================== CHECK 9JALINGO CREDITS ====================
/**
 * GET /tts/credits
 * Check if API key is configured
 */
router.get("/tts/credits", async (req, res) => {
    try {
        const NINE_JALINGO_API_KEY = process.env.NINE_JALINGO_API_KEY;
        if (!NINE_JALINGO_API_KEY) {
            return res.status(500).json({ status: 'error', message: '9jaLingo API key not configured' });
        }

        res.status(200).json({
            status: 'success',
            message: 'API key is configured'
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==================== MISTRAL AI GENERATION (for Timmy) ====================
/**
 * POST /generate
 * Generate AI response using Mistral (used by Timmy AI chat)
 */
router.post("/generate", async (req, res) => {
    try {
        const { prompt } = req.body;
        const apiKey = process.env.MISTRAL_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ 
                status: 'error', 
                message: 'MISTRAL_API_KEY not configured' 
            });
        }

        if (!prompt) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Prompt is required' 
            });
        }

        const client = new Mistral({ apiKey: apiKey });
        const chatResponse = await client.chat.complete({
            model: 'mistral-small-2506',
            messages: [{ role: 'user', content: prompt }],
        });

        console.log('ClearWords chat:', chatResponse.choices[0].message.content);
        res.status(200).json({
            status: 'success',
            data: chatResponse.choices[0].message.content
        });

    } catch (error) {
        console.error('Generate error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

module.exports = router;