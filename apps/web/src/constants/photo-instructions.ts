/**
 * Photo Upload Instructions
 * 
 * Single source of truth for photo-taking guidelines shown to users
 * during the move estimation flow.
 * 
 * These instructions are displayed in the UI modal after users complete
 * the chat data collection stage.
 */

export const PHOTO_INSTRUCTIONS = {
  whatToPhotograph: {
    title: 'What to Photograph:',
    items: [
      'Each room you\'re moving items from',
      'Large furniture pieces from multiple angles',
      'All packed or unpacked boxes',
      'Appliances, electronics, and fragile items',
      'Any oversized or special items',
    ],
  },
  photoTips: {
    title: 'Photo Tips for Best Results:',
    items: [
      '✓ Good lighting - open curtains or turn on lights',
      '✓ Clear, focused shots - no blurry images',
      '✓ Include reference objects (doorways, light switches) for scale',
      '✓ Capture full items - not just parts',
      '✓ Multiple angles for large furniture',
    ],
  },
  whatNotToDo: {
    title: 'What NOT to Do:',
    items: [
      '✗ Dark or poorly lit photos',
      '✗ Too far away - items should be clearly visible',
      '✗ Extreme close-ups that don\'t show full items',
      '✗ Photos with people in them (privacy)',
    ],
  },
  howMany: {
    label: 'How Many Photos:',
    text: 'Typically 5-10 photos for an average 2-3 bedroom home. More is better than less!',
  },
} as const

