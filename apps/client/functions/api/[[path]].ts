/**
 * Cloudflare Pages Function to proxy API requests to the backend Worker
 * 
 * Supports two connection modes:
 * 1. Service Binding (recommended) - Direct Worker-to-Worker communication via BACKEND binding
 * 2. HTTP Proxy (fallback) - Uses BACKEND_URL environment variable
 * 
 * Service Bindings are faster and more reliable as they don't require external network calls.
 */

/**
 * Service binding interface for Cloudflare Workers
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
 */
interface ServiceBinding {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

interface Env {
  // Service binding to backend Worker (preferred)
  BACKEND?: ServiceBinding;
  // Fallback HTTP URL (legacy support)
  BACKEND_URL?: string;
}

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;
  
  try {
    const url = new URL(request.url);
    
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

    let response: Response;

    // Method 1: Use Service Binding (preferred - faster and more reliable)
    if (env.BACKEND) {
      // Service binding uses relative URLs - the path is forwarded directly
      response = await env.BACKEND.fetch(
        new Request(url.pathname + url.search, fetchOptions)
      );
    }
    // Method 2: HTTP Proxy fallback (requires BACKEND_URL env var)
    else if (env.BACKEND_URL) {
      const targetUrl = new URL(url.pathname + url.search, env.BACKEND_URL);
      response = await fetch(targetUrl.toString(), fetchOptions);
    }
    // No backend configured
    else {
      console.error('Neither BACKEND service binding nor BACKEND_URL is configured');
      return new Response(
        JSON.stringify({ 
          error: 'Backend configuration error',
          hint: 'Configure BACKEND service binding in wrangler.toml or set BACKEND_URL secret'
        }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
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
