#!/usr/bin/env node
// Apply the `skill-only` agent preset to a DSH profile patch.
//
// Why this script exists
// ----------------------
// Group enable/disable in dsh-skill-manager works by renaming the managed copy
// under the import target (`$DSH_HOME/skills`). DSH, however, merges skills from
// several roots (`~/.agents/skills`, project roots, the bundled dir). If the same
// skill is still discoverable in another root, switching groups has no visible
// effect. The fix is an agent preset whose `skill-filesystem` row discovers the
// import target only.
//
// DSH changed how a preset is declared:
//   * DSH < 0.1.7 — a directory `$DSH_HOME/.agent-presets/<id>/` holding
//     `preset.yml` + `agent.cordis.yml`, selected through `settings.yaml`
//     (`agent-presets: { default: <id> }`).
//   * DSH >= 0.1.7 — declarative rows in the profile composition: one
//     `@deepseek-ai/dsh-agent-preset` row per preset (shipped as
//     `@deepseek-ai/dsh-web-app/presets/*.patch.yml`), and the default comes from
//     the `@deepseek-ai/dsh-agent-preset-registry` row's `config.default`.
//     The old directory form is no longer read at all, so a preset that still
//     lives there fails session resume with
//     `Unknown agent preset: <id> (gateway/internal)`.
//
// This script implements the >= 0.1.7 form. It copies the *installed* `standard`
// preset's plugin list (so the capability set always matches the DSH you actually
// run) and narrows its `skill-filesystem` row to the import target.
//
// Usage
// -----
//   node scripts/apply-skill-only-preset.mjs [options]
//
//   --profile <name>   profile to patch                    (default: web)
//   --patch <path>     patch file to write                 (default: <profile>/cordis.patch.yml)
//   --root <path>      skill root to discover              (default: importTarget from
//                                                           $DSH_HOME/skill-mgmt.json,
//                                                           else $DSH_HOME/skills)
//   --refresh          regenerate an existing skill-only row (use after a DSH upgrade)
//   --dry-run          print the block that would be appended, write nothing
//   --help             show this help
//
// Idempotent: without `--refresh` an already-applied preset is left alone. Every
// write is preceded by a timestamped backup next to the patch file.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const PRESET_ID = 'skill-only';
const ROW_ID = 'preset-skill-only';
const REGISTRY_ID = 'agent-preset-registry';
const PRESET_NAME = '技能管理';
const PRESET_DESCRIPTION = '完整编码 Agent 能力，但只从 $DSH_HOME/skills 一个根发现技能，让分组的启停真正生效。';

function fail(message) {
  console.error('[skill-only] ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { profile: 'web', patch: null, root: null, refresh: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--refresh') opts.refresh = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--profile') opts.profile = argv[++i];
    else if (arg === '--patch') opts.patch = argv[++i];
    else if (arg === '--root') opts.root = argv[++i];
    else fail(`unknown argument: ${arg} (try --help)`);
  }
  if (!opts.profile && !opts.patch) fail('--profile needs a value');
  return opts;
}

function usage() {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 46).join('\n').replace(/^\/\/ ?/gm, ''));
}

/** Resolve DSH_HOME the same way the harness does. */
function resolveDshHome() {
  const configured = process.env.DSH_HOME;
  return configured && configured.trim() ? resolve(configured) : join(homedir(), '.dsh');
}

/** Read the plugin's own import target so the preset root cannot drift from it. */
function resolveSkillRoot(dshHome, override) {
  if (override) return resolve(override);
  const configPath = join(dshHome, 'skill-mgmt.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (typeof cfg.importTarget === 'string' && cfg.importTarget.trim()) return resolve(cfg.importTarget);
      if (Array.isArray(cfg.sourceDirs) && typeof cfg.sourceDirs[0] === 'string') {
        // No importTarget recorded: fall back to the documented default below.
      }
    } catch (error) {
      console.warn(`[skill-only] could not parse ${configPath} (${error.message}); using the default root`);
    }
  }
  return join(dshHome, 'skills');
}

/** Locate the shipped `standard` agent preset of the installed DSH. */
function findStandardPreset(profileDir, dshHome) {
  const spec = '@deepseek-ai/dsh-web-app/presets/standard.patch.yml';
  const bases = [profileDir, join(profileDir, 'node_modules'), join(dshHome, 'profiles')];
  for (const base of bases) {
    for (const name of ['package.json', 'index.js']) {
      const anchor = join(base, name);
      if (!existsSync(anchor)) continue;
      try {
        const resolved = createRequire(anchor).resolve(spec);
        if (existsSync(resolved)) return resolved;
      } catch {}
    }
  }
  return null;
}

const indentOf = (line) => line.match(/^[ \t]*/)[0].length;

/** End index (exclusive) of the YAML list item that starts at `start`. */
function itemEnd(lines, start) {
  const itemIndent = indentOf(lines[start]);
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      index++;
      continue;
    }
    if (indentOf(line) <= itemIndent) break;
    index++;
  }
  return index;
}

/** Extract the `plugins:` list body of the `preset-standard` row, verbatim. */
function extractStandardPlugins(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rowStart = lines.findIndex((line) => /^\s*- id: preset-standard\s*$/.test(line));
  if (rowStart === -1) {
    fail('could not find the `- id: preset-standard` row in the installed standard preset');
  }
  const rowEnd = itemEnd(lines, rowStart);
  const pluginsAt = lines.findIndex(
    (line, index) => index > rowStart && index < rowEnd && /^\s*plugins:\s*$/.test(line),
  );
  if (pluginsAt === -1) fail('could not find `plugins:` in the installed standard preset row');
  const bodyIndent = indentOf(lines[pluginsAt]) + 2;
  const body = [];
  for (let index = pluginsAt + 1; index < rowEnd; index++) {
    const line = lines[index];
    if (line.trim() === '') {
      body.push(line);
      continue;
    }
    if (indentOf(line) < bodyIndent) break;
    body.push(line);
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  if (!body.length) fail('the standard preset row declares an empty plugin list');
  return body;
}

/** Replace the copied `skill-filesystem` row's discovery config with the single root. */
function narrowSkillFilesystem(pluginLines, skillRoot, standardPresetPath) {
  const rowStart = pluginLines.findIndex((line) => /^\s*- id: skill-filesystem\s*$/.test(line));
  if (rowStart === -1) {
    fail('the standard preset has no `skill-filesystem` row; refusing to guess');
  }
  const nameLine = pluginLines[rowStart + 1];
  if (!nameLine || !/^\s*name:/.test(nameLine)) {
    fail('unexpected shape after the `skill-filesystem` row; refusing to guess');
  }
  const itemIndent = indentOf(pluginLines[rowStart]);
  const configIndent = ' '.repeat(itemIndent + 2);
  const bodyIndent = ' '.repeat(itemIndent + 4);
  const replacement = [
    nameLine,
    `${configIndent}config:`,
    `${bodyIndent}# Discovery narrowed to the single managed root: with one root the`,
    `${bodyIndent}# on-disk SKILL.md / SKILL.md.disable state IS the model catalog, which is`,
    `${bodyIndent}# what makes group enable/disable observable at all.`,
    `${bodyIndent}includeDefaultRoots: false`,
    `${bodyIndent}customSkillDirs:`,
    `${bodyIndent}  - '${String(skillRoot).replace(/'/g, "''")}'`,
  ];
  const rowEnd = itemEnd(pluginLines, rowStart);
  return [
    ...pluginLines.slice(0, rowStart),
    `${pluginLines[rowStart]}`,
    ...replacement,
    ...pluginLines.slice(rowEnd),
  ];
}

function buildBlock(pluginLines) {
  return [
    '# ── skill-only agent preset ──────────────────────────────────────────────────',
    '# Declared the DSH >= 0.1.7 way: a `@deepseek-ai/dsh-agent-preset` row in the',
    '# profile composition. The capability set below is copied verbatim from the',
    '# installed `standard` preset of @deepseek-ai/dsh-web-app; only its',
    '# `skill-filesystem` row differs, discovering the Skill Manager import target',
    '# as the single root so group enable/disable is authoritative.',
    '#',
    '# Re-run `node scripts/apply-skill-only-preset.mjs --refresh` after a DSH',
    '# upgrade to re-copy the current standard plugin list.',
    '- insert:',
    `    - id: ${ROW_ID}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${PRESET_ID}`,
    `        name: ${PRESET_NAME}`,
    `        description: '${PRESET_DESCRIPTION}'`,
    '        order: 0',
    '        plugins:',
    ...pluginLines,
    '',
    '# Make that preset the default for new sessions (the bundle ships',
    "# `default: standard`; this id-targeted override replaces it).",
    `- id: ${REGISTRY_ID}`,
    '  config:',
    `    default: ${PRESET_ID}`,
  ];
}

/** Block boundaries of an already-applied skill-only preset, or null. */
function findApplied(lines) {
  const rowAt = lines.findIndex((line) => new RegExp(`^\\s*- id: ${ROW_ID}\\s*$`).test(line));
  if (rowAt === -1) return null;
  const rowIndent = indentOf(lines[rowAt]);
  let start = rowAt;
  if (rowIndent > 0) {
    // walk back to the `- insert:` (or other list item) that introduces the row
    for (let index = rowAt - 1; index >= 0; index--) {
      const line = lines[index];
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      if (indentOf(line) < rowIndent) {
        start = index;
        break;
      }
    }
  }
  return { start, end: itemEnd(lines, rowAt) };
}

/** Drop a stale registry default override so the new one can take its place. */
function stripRegistryOverride(lines) {
  const kept = [];
  let removed = false;
  for (let index = 0; index < lines.length; index++) {
    if (new RegExp(`^- id: ${REGISTRY_ID}\\s*$`).test(lines[index])) {
      index = itemEnd(lines, index) - 1;
      removed = true;
      while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
      continue;
    }
    kept.push(lines[index]);
  }
  return { lines: kept, removed };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return usage();

  const dshHome = resolveDshHome();
  const profileDir = join(dshHome, 'profiles', opts.profile);
  const patchPath = resolve(opts.patch ?? join(profileDir, 'cordis.patch.yml'));
  const skillRoot = resolveSkillRoot(dshHome, opts.root);

  if (!existsSync(patchPath)) {
    fail(`profile patch not found: ${patchPath}\n` +
      '        Boot the profile once so DSH creates it, then re-run this script.');
  }

  const standardPresetPath = findStandardPreset(profileDir, dshHome);
  if (!standardPresetPath) {
    fail('could not find @deepseek-ai/dsh-web-app/presets/standard.patch.yml.\n' +
      '        This script implements the DSH >= 0.1.7 declarative preset format.\n' +
      '        On an older DSH, use a directory preset at $DSH_HOME/.agent-presets/<id>/ instead.');
  }

  const original = readFileSync(patchPath, 'utf8');
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const applied = findApplied(lines);

  if (applied && !opts.refresh) {
    console.log(`[skill-only] already applied in ${patchPath} (row ${ROW_ID}).`);
    console.log('[skill-only] pass --refresh to re-copy the installed standard plugin list.');
    return;
  }

  const pluginLines = narrowSkillFilesystem(
    extractStandardPlugins(readFileSync(standardPresetPath, 'utf8')),
    skillRoot,
    standardPresetPath,
  );
  const block = buildBlock(pluginLines);

  let kept = lines;
  if (applied) {
    kept = [...lines.slice(0, applied.start), ...lines.slice(applied.end)];
  }
  const stripped = stripRegistryOverride(kept);
  kept = stripped.lines;
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  const next = `${kept.join('\n')}\n\n${block.join('\n')}\n`;

  const summary = [
    `patch        ${patchPath}`,
    `standard     ${standardPresetPath}`,
    `skill root   ${skillRoot}`,
    `rows         preset-skill-only (${pluginLines.length} plugin lines) + ${REGISTRY_ID}.default`,
    applied ? 'mode         refresh (replacing the existing preset row)' : 'mode         append',
  ];
  console.log(summary.join('\n'));

  if (opts.dryRun) {
    console.log('\n--- dry run: block that would be written ---\n');
    console.log(block.join('\n'));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${patchPath}.bak-skill-only-${stamp}`;
  copyFileSync(patchPath, backupPath);
  writeFileSync(patchPath, next, 'utf8');

  console.log(`\nbackup       ${backupPath}`);
  console.log('\nNext: fully restart dsh web (end the process and start it again — a page');
  console.log('refresh is not enough: the profile composition is read at boot).');
  console.log(`Then new sessions default to the \`${PRESET_ID}\` preset, and sessions already`);
  console.log(`pinned to \`${PRESET_ID}\` resume again.`);
  console.log('\nNote: with a single root, skills that only live in ~/.agents/skills stop');
  console.log('being discovered. Import the ones you want into the import target first.');
}

main();
