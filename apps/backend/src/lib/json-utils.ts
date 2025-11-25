/**
 * Utility functions for parsing and repairing JSON from LLM responses.
 */

/**
 * Extracts JSON from LLM response (handles markdown code blocks or plain JSON)
 * and attempts to repair incomplete JSON by closing braces/brackets.
 * 
 * @param text - The LLM response text that may contain JSON
 * @returns Parsed JSON object
 * @throws Error if no JSON found or if repair fails
 */
export function extractAndRepairJSON(text: string): any {
  // Extract JSON (might be in markdown code blocks or plain)
  let jsonText = '';
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    jsonText = jsonBlockMatch[1]!;
  } else {
    // Try to find JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    } else {
      throw new Error('No JSON found in response');
    }
  }
  
  // Try to parse
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    // If JSON is incomplete, try simple repair: close open braces/brackets
    const openBraces = (jsonText.match(/\{/g) || []).length;
    const closeBraces = (jsonText.match(/\}/g) || []).length;
    const openBrackets = (jsonText.match(/\[/g) || []).length;
    const closeBrackets = (jsonText.match(/\]/g) || []).length;
    
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      jsonText += ']';
    }
    for (let i = 0; i < openBraces - closeBraces; i++) {
      jsonText += '}';
    }
    
    return JSON.parse(jsonText);
  }
}

