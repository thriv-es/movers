/**
 * Cloudflare Pages Function to proxy API requests to the backend Worker
 * 
 * This function intercepts all requests to /api/* and forwards them to the backend Worker.
 * The [[path]] syntax is a catch-all route that matches any path under /api/
 * 
 * Environment Variables:
 * - BACKEND_URL: The URL of your deployed backend worker (required)
 */

interface Env {
  BACKEND_URL: string;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  
  try {
    const url = new URL(request.url);
    
    // Get the backend URL from environment variable
    const backendUrl = env.BACKEND_URL;
    
    if (!backendUrl) {
      console.error('BACKEND_URL environment variable is not set');
      return new Response(
        JSON.stringify({ 
          error: 'Backend configuration error. Please contact support.' 
        }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Construct the target URL by replacing the origin with the backend URL
    const targetUrl = new URL(url.pathname + url.search, backendUrl);
    
    // Clone headers and remove host header (will be set automatically)
    const headers = new Headers(request.headers);
    headers.delete('host');
    
    // Create a new request with the same method, headers, and body
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
      // @ts-ignore - duplex is needed for streaming requests with body
      duplex: request.method !== 'GET' && request.method !== 'HEAD' ? 'half' : undefined,
    });
    
    // Forward the request to the backend
    const response = await fetch(newRequest);
    
    // Create a new response with CORS headers preserved
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    
    return newResponse;
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to proxy request to backend',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), 
      { 
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

