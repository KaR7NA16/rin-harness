/**
 * Single static boundary for the Tauri core commands used by the web shell.
 *
 * Keeping these imports consistent avoids Vite's mixed static/dynamic import
 * warning and makes the non-Tauri guards explicit at each call site.
 */
export { convertFileSrc, invoke } from '@tauri-apps/api/core'
