import type { Preview } from '@storybook/web-components'

// The REAL design tokens — the same layered CSS the organism imports. This is
// the "Storybook import" the token system must serve. Importing it makes every
// story render under the real reference → semantic → component → theme → skin
// cascade.
import '@shrubbery/tokens/tokens.css'

// The applier ({skin,theme} → root attributes) — the SOLE programmatic stamp,
// tied to the sux ConfigValue.appliesAttribute pattern. The toolbar globals
// below drive it; Storybook re-renders the decorator on every global change.
import { applySkinTheme, type Skin, type Theme } from '@shrubbery/tokens'

const preview: Preview = {
  // Toolbar globals = the two ConfigDimensions that are pure presentation:
  // dim-skin (garden | emporium | 98 | glass | research | greenhouse) and dim-theme (light | dark). Orthogonal.
  globalTypes: {
    skin: {
      description: 'Skin (sux dim-skin)',
      defaultValue: 'garden',
      toolbar: {
        title: 'Skin',
        icon: 'paintbrush',
        items: [
          { value: 'garden', title: 'Garden (fern)' },
          { value: 'emporium', title: 'Emporium (purple)' },
          { value: '98', title: '98 (classic desktop)' },
          { value: 'glass', title: 'Glass (luminous desktop)' },
          { value: 'research', title: 'Research (SRS)' },
          { value: 'greenhouse', title: 'Greenhouse (sans Garden)' },
        ],
        dynamicTitle: true,
      },
    },
    theme: {
      description: 'Theme (sux dim-theme)',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },

  decorators: [
    (story, context) => {
      const skin = (context.globals.skin as Skin) ?? 'garden'
      const theme = (context.globals.theme as Theme) ?? 'light'
      // Stamp [data-skin]/[data-theme] on <html> — the cascade re-skins the
      // story live, exactly as the organism does. The preview iframe's <html>
      // IS the document element here, so the default target is correct.
      applySkinTheme({ skin, theme })
      // Paint the canvas with the (now-skinned) surface so swatches read in
      // context — uses the live token, never a hardcoded color.
      document.body.style.background = 'var(--mn-color-surface-base)'
      document.body.style.color = 'var(--mn-color-text-primary)'
      document.body.style.fontFamily = 'var(--mn-font-chrome)'
      return story()
    },
  ],

  parameters: {
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
}

export default preview
