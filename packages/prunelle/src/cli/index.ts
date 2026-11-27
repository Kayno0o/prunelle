#!/usr/bin/env bun
// The prunelle CLI: `prunelle new`, `prunelle check`, `prunelle dev`, `prunelle build`, `prunelle start`, `prunelle upgrade`, plus plugin-registered commands
// (e.g. `prunelle ui-eject <grammar> [dest]`, `prunelle mcp-footprint`). Parsing, help, typo hints, completion and exit codes come from @kaynooo/cli-kit.

import type { Cli, Commands } from '@kaynooo/cli-kit'
import { Exit, parse, runCli as runKit } from '@kaynooo/cli-kit'
import { loadConfig } from '../plugins/index'
import { builtinCommands, takeRoot } from './commands'

export interface RunCliOptions {
  cwd?: string | undefined
}

// The plugin commands of the app's prunelle.config.ts, read only when the first word names no built-in command (or for --help and completion).
function pluginCommands(cwd: string): (words: string[]) => Promise<Commands> {
  return async (words) => {
    const help = words.includes('--help') || words.includes('-h')
    let config: Awaited<ReturnType<typeof loadConfig>>
    try {
      config = await loadConfig(takeRoot(words.filter(word => word !== '--help' && word !== '-h'), cwd).root)
    }
    catch (error) {
      // `prunelle --help` and completion still list the built-ins; the command typed names why its config did not load.
      const name = words[0]
      if (help || name === undefined || name.startsWith('-'))
        return {}
      const reason = error instanceof Exit ? error : new Exit(error instanceof Error ? error.message : String(error), 1)
      return { [name]: { summary: '', hidden: true, run: async () => { throw reason } } }
    }
    const commands: Commands = {}
    for (const plugin of config.plugins ?? []) {
      for (const [name, run] of Object.entries(plugin.commands ?? {})) {
        commands[name] = {
          summary: `command of the ${plugin.name} plugin`,
          run: async (args) => {
            // Only --help is the kit's to read: the plugin parses its own arguments.
            parse(args.filter(arg => arg === '--help' || arg === '-h'), `prunelle ${name} [args...]: the ${name} command of the ${plugin.name} plugin`, {
              root: { type: 'string', description: 'the app directory (default: the current one)' },
            })
            const taken = takeRoot(args, cwd)
            await run(taken.rest, taken.root)
            return 0
          },
        }
      }
    }
    return commands
  }
}

export function prunelleCli(cwd = process.cwd()): Cli {
  return {
    name: 'prunelle',
    about: 'the Bun-native full-stack web framework',
    commands: builtinCommands(cwd),
    extraCommands: pluginCommands(cwd),
    // A public framework writes no usage log into its users' home.
    usage: false,
  }
}

export function runCli(argv: readonly string[], options: RunCliOptions = {}): Promise<number> {
  return runKit(prunelleCli(options.cwd), [...argv])
}

if (import.meta.main) {
  const code = await runCli(Bun.argv.slice(2))
  if (code !== 0)
    process.exit(code)
}
