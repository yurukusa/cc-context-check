# cc-context-check

See exactly how full your Claude Code context window is — right from your terminal.

```
npx cc-context-check
```

## What it does

Reads token usage directly from your `~/.claude/projects/` session transcripts and shows:

- **Context fill %** with a color-coded progress bar
- **Token counts**: input used (including cache), output, remaining
- **Smart warnings**: yellow at 70%, red at 85% (time to `/compact`)
- **Last 5 active sessions** across all your Claude Code projects

## Example output

```
cc-context-check — Context window usage across sessions

Context limit: 200.0k tokens (Claude Sonnet/Opus)

🟢 ~/projects/my-app    [a3f9c12] just now · 12.4 MB
   ████████████░░░░░░░░░░░░░░░░░░ 40.1% used
   80.2k input · 1.2k output · 119.8k remaining

🟡 ~/                   [b7d44e1] 2h ago · 5.9 MB
   █████████████████████░░░░░░░░░ 71.5% used
   143.0k input · 89 output · 57.0k remaining
   △ Warning: Context is getting full — consider /compact
```

## Options

```
--all, -a    Show top 20 sessions instead of 5
--json       JSON output for scripting
```

## Why this exists

Claude Code's context window is 200k tokens. When it fills up, responses slow down and you lose context of earlier work. `/compact` compresses history — but knowing *when* to compact is guesswork without this tool.

cc-context-check reads the actual `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` from your session files to give you the real number.

## Part of cc-toolkit

One of 43 free tools for Claude Code users → [cc-toolkit](https://yurukusa.github.io/cc-toolkit/)

## License

MIT
