/**
 * Cloudflare Pages Function to proxy API requests to the backend Worker
 */

// Hardcoded backend URL - simplest approach that works
const BACKEND_URL = 'https://movers.assaf-6f5.workers.dev';

export async function onRequest(context: { request: Request }) {
  const { request } = context;
  
  try {
    const url = new URL(request.url);
    
    // Construct target URL
    const targetUrl = new URL(url.pathname + url.search, BACKEND_URL);
    
    // Create headers (remove host to avoid conflicts)
    const headers = new Headers(request.headers);
    headers.delete('host');
    
    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: headers,
    };

    // Add body for non-GET/HEAD requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = request.body;
    }

    // Forward the request to backend
    const response = await fetch(targetUrl.toString(), fetchOptions);
    
    // Return the response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Proxy failed',
        details: error instanceof Error ? error.message : String(error)
      }), 
      { 
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
