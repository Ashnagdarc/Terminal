export const COMMAND_LIST = [
  'help',
  'clear',
  'about',
  'status',
  'metrics',
  'uptime',
  'time',
  'theme',
  'ask',
  'weather',
  'docs',
  'code',
  'summarize-url',
  'key',
  'remember',
  'memories',
  'forget',
  'memory',
  'pin',
  'pins',
  'unpin',
  'sound',
  'post',
  'api',
  'mode',
  'sources',
  'settings',
  'cancel',
  'retry'
];

export function parseCommand(rawInput) {
  const raw = String(rawInput || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return { type: 'empty', raw, trimmed, args: [], command: '' };
  }

  const [first, ...rest] = trimmed.split(/\s+/);
  const command = first.toLowerCase();
  const argText = rest.join(' ').trim();

  if (command === 'help') return { type: 'help', raw, trimmed, command, args: rest, argText };
  if (command === 'clear') return { type: 'clear', raw, trimmed, command, args: rest, argText };
  if (command === 'about') return { type: 'about', raw, trimmed, command, args: rest, argText };
  if (command === 'status') return { type: 'status', raw, trimmed, command, args: rest, argText };
  if (command === 'metrics') return { type: 'metrics', raw, trimmed, command, args: rest, argText };
  if (command === 'uptime') return { type: 'uptime', raw, trimmed, command, args: rest, argText };
  if (command === 'time') return { type: 'time', raw, trimmed, command, args: rest, argText };
  if (command === 'cancel') return { type: 'cancel', raw, trimmed, command, args: rest, argText };
  if (command === 'retry') return { type: 'retry', raw, trimmed, command, args: rest, argText };
  if (command === 'settings') return { type: 'settings', raw, trimmed, command, args: rest, argText };

  if (command === 'remember') return { type: 'remember', raw, trimmed, command, args: rest, argText };
  if (command === 'memories') return { type: 'memories', raw, trimmed, command, args: rest, argText };
  if (command === 'forget') return { type: 'forget', raw, trimmed, command, args: rest, argText, target: (rest[0] || '').toLowerCase() };

  if (command === 'memory') {
    return {
      type: 'memory',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      value: (rest[0] || '').toLowerCase()
    };
  }

  if (command === 'pin') return { type: 'pin', raw, trimmed, command, args: rest, argText };
  if (command === 'pins') return { type: 'pins', raw, trimmed, command, args: rest, argText };
  if (command === 'unpin') return { type: 'unpin', raw, trimmed, command, args: rest, argText, target: (rest[0] || '').toLowerCase() };

  if (command === 'sound') {
    return {
      type: 'sound',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      action: (rest[0] || 'show').toLowerCase(),
      value: (rest[1] || '').toLowerCase()
    };
  }

  if (command === 'post') {
    return {
      type: 'post',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      value: (rest[0] || 'show').toLowerCase()
    };
  }

  if (command === 'api') {
    const action = (rest[0] || 'show').toLowerCase();
    return {
      type: 'api',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      action,
      value: rest.slice(1).join(' ').trim()
    };
  }

  if (command === 'mode') {
    return {
      type: 'mode',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      value: (rest[0] || '').toLowerCase()
    };
  }

  if (command === 'sources') {
    return {
      type: 'sources',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      value: (rest[0] || '').toLowerCase()
    };
  }

  if (command === 'theme') {
    return {
      type: 'theme',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      theme: (rest[0] || '').toLowerCase()
    };
  }

  if (command === 'ask') {
    return {
      type: 'ask',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      prompt: argText
    };
  }

  if (command === 'key') {
    const action = (rest[0] || 'show').toLowerCase();
    return {
      type: 'key',
      raw,
      trimmed,
      command,
      args: rest,
      argText,
      action,
      provider: (rest[1] || '').toLowerCase(),
      apiKey: rest.slice(2).join(' ').trim()
    };
  }

  return { type: 'remote', raw, trimmed, command, args: rest, argText };
}

export function autocompleteCommand(input, commands = COMMAND_LIST) {
  const raw = String(input || '');
  const startTrimmed = raw.trimStart();
  const parts = startTrimmed.split(/\s+/);
  if (parts.length > 1) {
    return { nextInput: raw, matches: [] };
  }

  const prefix = (parts[0] || '').toLowerCase();
  if (!prefix) {
    return { nextInput: raw, matches: [] };
  }

  const matches = commands.filter((cmd) => cmd.startsWith(prefix));
  if (matches.length === 1) {
    return { nextInput: `${matches[0]} `, matches };
  }
  return { nextInput: raw, matches };
}
