/*
 * This is your new serverless function.
 * It runs on Netlify's servers, not in the user's browser.
 * It will securely access your API key from an environment variable.
 */

// Your secret API key is stored as an environment variable in Netlify, not in the code!
const API_KEY = process.env.GEMINI_API_KEY;
// Your reCAPTCHA secret key, also stored in Netlify
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

// This is the main function handler
exports.handler = async (event, context) => {
    
    // 1. Only allow POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        // 2. Get the text, style, AND token from the HTML page
        const { inputText, style, token } = JSON.parse(event.body);

        if (!inputText || !style || !token) {
            return { statusCode: 400, body: "Missing inputText, style, or token" };
        }
        
        // 3. Check if Secret Keys are configured
        if (!API_KEY || !RECAPTCHA_SECRET) {
            console.error("Server configuration error: Missing API_KEY or RECAPTCHA_SECRET");
            return { statusCode: 500, body: "Server configuration error. Please contact the administrator." };
        }

        // 4. Verify the reCAPTCHA token with Google
        const recaptchaResponse = await fetch(RECAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            // We send our SECRET key and the user's token to Google for verification
            body: `secret=${RECAPTCHA_SECRET}&response=${token}`
        });

        const recaptchaData = await recaptchaResponse.json();

        // 5. Check the verification score
        // We check for success AND a score > 0.5 (common threshold)
        if (!recaptchaData.success || recaptchaData.score < 0.5) {
            console.warn("reCAPTCHA verification failed. Likely a bot.", recaptchaData);
            return { statusCode: 403, body: "Forbidden. Bot-like activity detected." };
        }
        
        // 6. Construct the prompt for Google AI (this logic is moved from the HTML)
        const systemPrompt = `You are an expert text reformulator. Your task is to rewrite the given text in a new style.
You MUST adhere to the following rules:
1.  The rewritten text MUST be in the **same language** as the original input text.
2.  The rewritten text MUST have **approximately the same length** (word count or character count) as the original input text.
3.  You MUST rewrite the text in the following style: **${style}**.
4.  Respond ONLY with the rewritten text. Do not add apologies, preambles, explanations, or any other text.`;

        const payload = {
            contents: [{ "parts": [{ "text": inputText }] }],
            systemInstruction: {
                "parts": [{ "text": systemPrompt }]
            },
            generationConfig: {
                "temperature": 0.8,
                "topP": 0.9,
                "topK": 40
            }
        };

        // 7. Securely call the Google AI API from the server
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("Google AI API Error:", errorBody);
            return { statusCode: response.status, body: `Google AI Error: ${response.statusText}` };
        }

        const result = await response.json();

        if (!result.candidates || !result.candidates[0].content?.parts?.[0]?.text) {
            console.error("Invalid API response:", result);
            return { statusCode: 500, body: "Invalid response from Google AI." };
        }

        // 8. Send *only* the result text back to the HTML page
        const reformulatedText = result.candidates[0].content.parts[0].text;
        
        return {
            statusCode: 200,
            body: JSON.stringify({ reformulatedText: reformulatedText })
        };

    } catch (error) {
        console.error("Serverless function error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
