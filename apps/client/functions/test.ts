/**
 * Simple test function to verify Pages Functions work
 */
export async function onRequest() {
  return new Response(JSON.stringify({ 
    message: 'Functions are working!',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

