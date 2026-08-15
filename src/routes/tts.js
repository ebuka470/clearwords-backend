const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * POST /api/tts/generate
 * Generate TTS audio using 9jaLingo
 */
router.post('/generate', async (req, res) => {
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

module.exports = router;