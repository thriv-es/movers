/** Narrow vocabulary permits phrasing variety, not arbitrary model-authored assertions. */
const photoWords = new Set(
  'could can would you please share attach upload add send some a few clear photos photo pictures picture of the your rooms room and large bulky items furniture belongings in this chat for inventory'.split(
    ' ',
  ),
)
export function safePhotoRequest(reply: string): boolean {
  if (
    reply.length > 160 ||
    !/^(could|can|would|please)\b/i.test(reply) ||
    !reply.endsWith('?') ||
    !/\b(photos?|pictures?)\b/i.test(reply)
  )
    return false
  return (
    /^[a-z ,?]+$/i.test(reply) &&
    reply
      .toLowerCase()
      .replace(/[?,]/g, '')
      .split(/\s+/)
      .every((word) => photoWords.has(word))
  )
}
