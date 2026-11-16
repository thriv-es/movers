/** The existing analysis fallback, shared by relevant inventory and customer-kept candidates. */
export function analysisBoxes(volume: number, min?: number, max?: number) {
  return {
    min: min ?? Math.max(5, Math.ceil((volume * 0.3) / 4)),
    max: max ?? Math.max(10, Math.ceil((volume * 0.3) / 3)),
  }
}
