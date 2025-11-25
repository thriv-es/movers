/**
 * Cloudflare Pages Function to proxy API requests to the backend Worker
 */

interface Env {
  BACKEND_URL: string;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  
  try {
    const url = new URL(request.url);
    
    // Get backend URL from environment variable
    const backendUrl = env.BACKEND_URL;
    
    if (!backendUrl) {
      console.error('BACKEND_URL environment variable is not set');
      return new Response(
        JSON.stringify({ error: 'Backend configuration error' }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Construct target URL
    const targetUrl = new URL(url.pathname + url.search, backendUrl);
    
    // Create headers
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

    // Forward the request
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
