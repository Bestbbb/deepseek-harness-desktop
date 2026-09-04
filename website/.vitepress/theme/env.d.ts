/** Vite handles stylesheet side-effect imports when building the theme. */
declare module '*.css' {}

/** The Mermaid plugin publishes a Vue component without a declaration file. */
declare module 'vitepress-plugin-mermaid/Mermaid.vue' {
  import type { DefineComponent } from 'vue'
  const Mermaid: DefineComponent<{ graph: string; id: string; class?: string }>
  export default Mermaid
}
