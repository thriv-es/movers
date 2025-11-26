/**
 * Simple test to see if any function in /api/ directory works
 */
export async function onRequest() {
  return new Response(JSON.stringify({ 
    message: 'Hello from /api/hello!',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

