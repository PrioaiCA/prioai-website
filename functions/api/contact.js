// Cloudflare Pages Function - Contact Form Proxy
// Proxies contact form submissions to n8n webhook to avoid CORS issues

export async function onRequestPost(context) {
    const { request } = context;

    // CORS headers for prioai.ca
    const corsHeaders = {
        'Access-Control-Allow-Origin': 'https://prioai.ca',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        // Get the request body
        const body = await request.json();

        // Forward to n8n webhook
        const response = await fetch('https://n8n.prioai.ca/webhook/feedback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (response.ok) {
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            });
        } else {
            throw new Error('Failed to send to webhook');
        }
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
            },
        });
    }
}

// Handle CORS preflight
export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://prioai.ca',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}
