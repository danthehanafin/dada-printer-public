// This is the "Waiter" server. It runs online, takes requests, talks to the AI,
// and securely sends the final print job to your home server.

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Vercel may need this explicit require

const app = express();

// --- CONFIGURATION - ADD YOUR SECRETS HERE ---
const LOCAL_PRINTER_URL = 'https://2442d018d2fd.ngrok-free.app/print'; 
const SECRET_KEY = 'dada-is-art'; 
const GEMINI_API_KEY = "AIzaSyDB_pV1tmjiguKM9bSBu6xJyqQ-WaPBcwo";

// --- THE FIX IS HERE ---
// We are explicitly telling the server to allow requests from your live website.
const corsOptions = {
  origin: 'https://danhanaf.in',
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// The main endpoint that the public website will call
app.post('/', async (req, res) => {
    const { firstName, lastInitial, userPrompt } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!firstName || !lastInitial || !userPrompt) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // 1. Get User Location from their IP Address
        let location = 'An unknown location'; 
        if (ip) {
            const geoResponse = await fetch(`https://ipapi.co/${ip}/json/`);
            if (geoResponse.ok) {
                const geoData = await geoResponse.json();
                if (geoData.city && geoData.region && geoData.country_name) {
                    location = `${geoData.city}, ${geoData.region}, ${geoData.country_name}`;
                }
            }
        }
        
        // 2. Call Gemini AI to generate the art
        console.log('Calling Gemini API...');
        const systemPrompt = `
            **Objective:** You are a master ASCII artist. Your sole purpose is to create visual art using a limited set of text characters for a 42-character wide thermal receipt printer.
            **CRITICAL RULES:**
            1. **CHARACTER SET:** ONLY use: \`| - _ / \\ + . : = * # % @ ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ░ ▒ ▓ █\`
            2. **DIMENSIONS:** Width MUST NOT exceed 42 characters. Height MUST NOT exceed 20 lines.
            3. **CONTENT:** Your response MUST be ONLY the raw ASCII art itself. NO other text.
        `;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };
        const aiApiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!aiApiResponse.ok) throw new Error(`Gemini API Error: ${aiApiResponse.statusText}`);
        const result = await aiApiResponse.json();
        const artText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!artText) throw new Error('AI did not return valid art.');

        // 3. Assemble the final text block to be printed
        const initCommand = Buffer.from([0x1b, 0x40]);
        const nameLine = `${firstName} ${lastInitial}.`;
        const locationLine = `from ${location}`;
        const feedBlock = '\n'.repeat(5);
        const finalOutput = `${userPrompt}\n\n${artText}\n\n${nameLine}\n${locationLine}${feedBlock}`;
        
        const dataToSend = Buffer.concat([initCommand, Buffer.from(finalOutput)]);

        // 4. Securely send the job to your local printer server via the ngrok tunnel
        console.log('Sending print job to local server via ngrok...');
        const printResponse = await fetch(LOCAL_PRINTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-secret-key': SECRET_KEY
            },
            body: JSON.stringify({ printData: dataToSend.toString('binary') })
        });

        if (!printResponse.ok) {
            const errorBody = await printResponse.text();
            console.error('Error from local server:', errorBody);
            throw new Error('The local printer server is offline or encountered an error.');
        }

        res.status(200).json({ message: 'Print job sent successfully!' });

    } catch (error) {
        console.error('An error occurred in generate-and-print:', error.message);
        res.status(500).json({ error: 'An internal error occurred. Please try again later.' });
    }
});

// This is required for Vercel to handle the routing correctly.
module.exports = app;

