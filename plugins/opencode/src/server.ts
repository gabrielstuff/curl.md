import { plugin as v1Plugin } from './server-v1.ts'
import { plugin as v2Plugin } from './server-v2.ts'

/**
 * Dual OpenCode entrypoint.
 *
 * - OpenCode v2 loads the default export and calls `setup(ctx)`.
 * - OpenCode v1 (1.18.29+) loads the default export and calls `server(input, options)`.
 *
 * Both parts share the same implementation in `./fetch.ts`.
 */
export const plugin = {
  ...v2Plugin,
  server: v1Plugin,
}

export { v1Plugin, v2Plugin }

export default plugin
