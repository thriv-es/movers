import type { ChatMessage, ChatApiResponse, EstimateResult } from '@workspace/data'

/**
 * API client for Move Estimate Demo endpoints.
 * Uses relative URLs that will be proxied to the backend.
 */

/**
 * Calls the chat API endpoint.
 */
export async function chatApi(messages: ChatMessage[]): Promise<ChatApiResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json() as Promise<ChatApiResponse>
}

/**
 * Calls the estimate API endpoint with messages and images.
 */
export async function estimateApi(
  messages: ChatMessage[],
  files: File[]
): Promise<EstimateResult> {
  const formData = new FormData()
  formData.append('messages', JSON.stringify(messages))

  for (const file of files) {
    formData.append('images', file)
  }

  const response = await fetch('/api/estimate', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json() as Promise<EstimateResult>
}

