import { extractAndRepairJSON } from '../lib/json-utils';

export interface AiGatewayBindings {
  AI_GATEWAY_AUTH_TOKEN: string;
  AI_GATEWAY_PROJECT_NAME: string;
}

export interface ImageAnalysisResult {
  items: Array<{ type: string; count: number }>;
  total_volume_cubic_feet: number;
}

export class AiGatewayService {
  private baseUrl = 'https://ai-gateway.nxty.ai';

  constructor(private env: AiGatewayBindings) {}

  async analyzeImages(imageUrls: string[]): Promise<ImageAnalysisResult> {
    // Call AI Gateway directly with URLs
    const promptVariables = {
      imageCount: imageUrls.length.toString(),
    };

    const response = await fetch(`${this.baseUrl}/v1/completion`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.env.AI_GATEWAY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'nxty-project': this.env.AI_GATEWAY_PROJECT_NAME,
      },
      body: JSON.stringify({
        prompt_name: 'image_analysis_agent',
        prompt_variables: promptVariables,
        files: imageUrls,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Gateway error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as { completion: string | object };
    
    // 3. Parse response
    let result: ImageAnalysisResult;
    try {
       if (typeof data.completion === 'object' && data.completion !== null) {
        result = data.completion as ImageAnalysisResult;
      } else {
        const completionText = typeof data.completion === 'string' ? data.completion : '';
        result = extractAndRepairJSON(completionText);
      }
      
      // Validate structure
      if (!result.items || !Array.isArray(result.items)) {
        throw new Error('Invalid response format: missing items array');
      }
      if (typeof result.total_volume_cubic_feet !== 'number') {
        throw new Error('Invalid response format: missing total_volume_cubic_feet');
      }
      
      return result;
    } catch (error) {
      console.error('Failed to parse AI Gateway response:', error);
      throw new Error('Failed to parse AI Gateway response');
    }
  }
}