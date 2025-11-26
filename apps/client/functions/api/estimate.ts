/**
 * Handle /api/estimate route - proxy to backend Worker
 */
const BACKEND_URL = 'https://movers.assaf-6f5.workers.dev';

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  
  try {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, BACKEND_URL);
    
    const headers = new Headers(request.headers);
    headers.delete('host');
    
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: headers,
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ error: 'Proxy failed', details: String(error) }), 
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

