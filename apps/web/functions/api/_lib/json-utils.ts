export function extractAndRepairJSON(text: string): any {
  let jsonText = '';
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (fenced) {
    jsonText = fenced[1]!;
  } else {
    const raw = text.match(/\{[\s\S]*\}/);
    if (raw) {
      jsonText = raw[0];
    } else {
      throw new Error('No JSON found in response');
    }
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    const openBraces = (jsonText.match(/\{/g) || []).length;
    const closeBraces = (jsonText.match(/\}/g) || []).length;
    const openBrackets = (jsonText.match(/\[/g) || []).length;
    const closeBrackets = (jsonText.match(/\]/g) || []).length;

    for (let i = 0; i < openBrackets - closeBrackets; i++) jsonText += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) jsonText += '}';

    return JSON.parse(jsonText);
  }
}
