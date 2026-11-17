import type { Config } from 'tailwindcss'
import { extract } from 'fluid-tailwind'
import { workspacePreset } from './tailwind'

const tailwindConfig = {
  darkMode: ['class'],
  presets: [workspacePreset],
  corePlugins: {
    container: false,
  },
  content: {
    extract,
    files: [
      './index.html',
      './src/**/*.{ts,tsx}',
    ],
    transform: {
      mdx: (src) =>
        src
          .replaceAll(/```.*?```/gs, '')
          .match(/<[^/].*?>/g)
          ?.join() ?? '',
    },
  },
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
    },
  },
} satisfies Config

export default tailwindConfig
