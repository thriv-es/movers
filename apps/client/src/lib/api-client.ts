import type { 
  ChatMessage, 
  ChatApiResponse, 
  AnalysisResult, 
  PriceResult, 
  MoveInfo,
  EstimateResult 
} from '@workspace/data'

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
 * Uploads images to the backend R2 storage.
 * Returns an array of URLs for the uploaded images.
 */
export async function uploadImages(files: File[]): Promise<string[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('images', file)
  }

  const response = await fetch('/api/images/upload', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json() as Promise<string[]>
}

/**
 * Analyzes images (by URL) to detect items and estimate volume/boxes.
 */
export async function analyzeApi(imageUrls: string[]): Promise<AnalysisResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageUrls }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json() as Promise<AnalysisResult>
}

/**
 * Gets pricing based on analysis results and move information.
 */
export async function priceApi(analysis: AnalysisResult, moveInfo: MoveInfo): Promise<PriceResult> {
  const response = await fetch('/api/price', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ analysis, moveInfo }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json() as Promise<PriceResult>
}

/**
 * Full estimate flow: upload → analyze → price
 * This is a convenience function that chains the three steps.
 */
export async function getEstimate(
  files: File[],
  moveInfo: MoveInfo
): Promise<EstimateResult> {
  // Step 1: Upload images
  console.log('getEstimate: Step 1 - Uploading', files.length, 'images...')
  const imageUrls = await uploadImages(files)
  console.log('getEstimate: Upload complete, got', imageUrls.length, 'URLs')

  // Step 2: Analyze images
  console.log('getEstimate: Step 2 - Analyzing images...')
  const analysis = await analyzeApi(imageUrls)
  console.log('getEstimate: Analysis complete:', {
    itemCount: analysis.items.length,
    volume: analysis.totalVolumeCubicFeet,
    boxes: analysis.estimatedBoxes,
  })

  // Step 3: Get pricing
  console.log('getEstimate: Step 3 - Getting price...')
  const priceResult = await priceApi(analysis, moveInfo)
  console.log('getEstimate: Price complete:', {
    total: priceResult.price.total,
    confidence: priceResult.price.confidence,
  })

  // Combine into EstimateResult
  return {
    items: analysis.items,
    estimatedBoxes: analysis.estimatedBoxes,
    boxesExplanation: analysis.boxesExplanation,
    price: priceResult.price,
  }
}
