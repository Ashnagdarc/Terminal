import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../app/commands-parser.mjs';

test('parse help command', () => {
  const parsed = parseCommand('help');
  assert.equal(parsed.type, 'help');
  assert.equal(parsed.command, 'help');
});

test('parse clear command', () => {
  const parsed = parseCommand('clear');
  assert.equal(parsed.type, 'clear');
  assert.equal(parsed.command, 'clear');
});

test('parse theme command with value', () => {
  const parsed = parseCommand('theme amber');
  assert.equal(parsed.type, 'theme');
  assert.equal(parsed.theme, 'amber');
});

test('parse ask command with prompt', () => {
  const parsed = parseCommand('ask explain recursion simply');
  assert.equal(parsed.type, 'ask');
  assert.equal(parsed.prompt, 'explain recursion simply');
});

test('parse key set command', () => {
  const parsed = parseCommand('key set perplexity pplx-example-key');
  assert.equal(parsed.type, 'key');
  assert.equal(parsed.action, 'set');
  assert.equal(parsed.provider, 'perplexity');
  assert.equal(parsed.apiKey, 'pplx-example-key');
});

test('parse mode command', () => {
  const parsed = parseCommand('mode brief');
  assert.equal(parsed.type, 'mode');
  assert.equal(parsed.value, 'brief');
});

test('parse sources command', () => {
  const parsed = parseCommand('sources on');
  assert.equal(parsed.type, 'sources');
  assert.equal(parsed.value, 'on');
});

test('parse sound volume command', () => {
  const parsed = parseCommand('sound volume 40');
  assert.equal(parsed.type, 'sound');
  assert.equal(parsed.action, 'volume');
  assert.equal(parsed.value, '40');
});

test('parse post command', () => {
  const parsed = parseCommand('post fast');
  assert.equal(parsed.type, 'post');
  assert.equal(parsed.value, 'fast');
});

test('parse remember command', () => {
  const parsed = parseCommand('remember prefers concise answers');
  assert.equal(parsed.type, 'remember');
  assert.equal(parsed.argText, 'prefers concise answers');
});

test('parse pin command', () => {
  const parsed = parseCommand('pin deploy checklist');
  assert.equal(parsed.type, 'pin');
  assert.equal(parsed.argText, 'deploy checklist');
});
