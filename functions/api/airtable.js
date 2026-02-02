// Cloudflare Pages Function - Secure Airtable Proxy
// Token comes from environment variable (AIRTABLE_TOKEN), never from frontend

// Configuration
const ALLOWED_BASE = 'applOjDjhH0RqLtBH';
const ALLOWED_TABLES = ['tblMptC862PyL7Znw', 'tblLpN4wceakfNFpq', 'tblvB5OpG0b5mVix3'];
const ALLOWED_ORIGINS = [
    'https://prioai.ca',
    'https://www.prioai.ca',
    'https://dashboard.prioai.ca',
    'http://localhost:8788',
    'http://localhost:3000',
    'http://127.0.0.1:8788',
    'http://127.0.0.1:3000'
];

// Rate limiting: 1000 requests/minute per IP
const RATE_LIMIT = 1000;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in ms

// Simple in-memory rate limiter (resets on cold start)
const rateLimitMap = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return false;
    }

    // Reset window if expired
    if (now - record.windowStart > RATE_LIMIT_WINDOW) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return false;
    }

    // Increment and check
    record.count++;
    if (record.count > RATE_LIMIT) {
        return true;
    }

    return false;
}

function getCorsHeaders(origin) {
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function validatePath(path) {
    // Path should be like: applOjDjhH0RqLtBH/tblMptC862PyL7Znw or applOjDjhH0RqLtBH/tblMptC862PyL7Znw/recXXXXX
    if (!path) return { valid: false, error: 'Missing path parameter' };

    const parts = path.split('/');
    if (parts.length < 2) {
        return { valid: false, error: 'Invalid path format' };
    }

    const base = parts[0];
    const table = parts[1];

    if (base !== ALLOWED_BASE) {
        return { valid: false, error: 'Invalid base ID' };
    }

    if (!ALLOWED_TABLES.includes(table)) {
        return { valid: false, error: 'Invalid table ID' };
    }

    return { valid: true };
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin);

    // Handle preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Get client IP for rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For')?.split(',')[0] ||
                     'unknown';

    // Check rate limit
    if (isRateLimited(clientIP)) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Validate origin (allow requests without origin for direct API calls, but log them)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Get and validate path
    const path = url.searchParams.get('path');
    const validation = validatePath(path);

    if (!validation.valid) {
        return new Response(JSON.stringify({ error: validation.error }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Check for token
    const airtableToken = env.AIRTABLE_TOKEN;
    if (!airtableToken) {
        console.error('AIRTABLE_TOKEN environment variable not set');
        return new Response(JSON.stringify({ error: 'Server configuration error' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    // Build Airtable URL
    let airtableUrl = `https://api.airtable.com/v0/${path}`;

    // Forward query parameters (except 'path')
    const forwardParams = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
        if (key !== 'path') {
            forwardParams.append(key, value);
        }
    }
    const queryString = forwardParams.toString();
    if (queryString) {
        airtableUrl += '?' + queryString;
    }

    // Build request options
    const fetchOptions = {
        method: request.method,
        headers: {
            'Authorization': `Bearer ${airtableToken}`,
            'Content-Type': 'application/json',
        },
    };

    // Forward body for POST/PATCH/PUT
    if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
        try {
            const body = await request.text();
            if (body) {
                fetchOptions.body = body;
            }
        } catch (e) {
            // No body, that's fine
        }
    }

    try {
        const response = await fetch(airtableUrl, fetchOptions);
        const data = await response.text();

        return new Response(data, {
            status: response.status,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
            }
        });
    } catch (error) {
        console.error('Airtable API error:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch from Airtable' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}
