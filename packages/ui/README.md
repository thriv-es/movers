# @movers/ui

The Movers comic design system: plain CSS plus a few React components, shared by the landing page
and the estimator. Every rule is namespaced under `.mv` / `.mv-*`, so it sits next to other styles.

## Usage

1. Add `"@movers/ui": "workspace:*"` to the app's dependencies and run `pnpm install`.
2. Import the stylesheets once per app, in this order, before the app's own CSS:

   ```ts
   import '@movers/ui/tokens.css'
   import '@movers/ui/components.css'
   ```

3. Fonts are not bundled. Install them in the app via fontsource (`@fontsource/bowlby-one`,
   `@fontsource-variable/fredoka`, `@fontsource-variable/inter`) and import them in the entry file.
4. Wrap the app in an element with class `mv-page` for the kraft background, focus ring and selection.
5. Use the components: `import { Button, Panel, Stepper } from '@movers/ui'`. Each one renders the
   matching `.mv-*` classes and forwards `className` and native props. The classes can also be used
   directly in markup (for example `.mv-table` in admin pages).

The package ships TypeScript source; consuming apps compile it with their own Vite setup.
Run `pnpm --filter @movers/ui test` and `pnpm --filter @movers/ui typecheck` to verify.
