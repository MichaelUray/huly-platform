// Image module declarations so TypeScript accepts the imports in
// LoginApp.svelte (login_back.{png,avif,webp} variants used for the
// responsive background). The actual files exist under ../../img/ and
// are served as static assets by webpack/build pipeline.

declare module '*.png'
declare module '*.avif'
declare module '*.webp'
declare module '*.jpg'
declare module '*.svg'
