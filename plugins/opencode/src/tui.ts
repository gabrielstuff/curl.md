import { tuiPlugin as v1TuiPlugin } from './tui-v1.ts'
import { tuiPlugin as v2TuiPlugin } from './tui-v2.ts'

/**
 * Dual OpenCode TUI entrypoint.
 *
 * - OpenCode v2 loads the default export and calls `setup(context)`.
 * - OpenCode v1 loads the default export and calls `tui(api)`.
 */
export const tuiPlugin = {
  ...v2TuiPlugin,
  tui: v1TuiPlugin.tui,
}

export { v1TuiPlugin, v2TuiPlugin }

export default tuiPlugin
