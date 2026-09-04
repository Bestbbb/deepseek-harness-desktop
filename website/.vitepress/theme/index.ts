/** The documentation theme with a responsive desktop product landing page. */
import DefaultTheme from 'vitepress/theme-without-fonts'
import type { Theme } from 'vitepress'
import { defineAsyncComponent } from 'vue'
import './desktop.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', defineAsyncComponent(() => import('vitepress-plugin-mermaid/Mermaid.vue')))
  },
} satisfies Theme
