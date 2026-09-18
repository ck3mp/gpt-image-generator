#!/usr/bin/env node
/**
 * Generate an image from a text prompt via the OpenAI image API.
 *
 * Reads the prompt from a .txt file and saves the generated image as a PNG,
 * exactly as returned by the API — no resizing, no size caps. Optionally
 * attaches one or more reference images, in which case the prompt is applied
 * to them via the image edits endpoint.
 *
 * Requires OPENAI_API_KEY. Uses OpenAI's top image model (see OPENAI_MODEL
 * below); GPT Image models are paid-only and need org verification.
 *
 * Usage:
 *   node generate_image.mjs --input prompt.txt                    # saves prompt.png
 *   node generate_image.mjs --input prompt.txt --output out.png   # custom output path
 *   node generate_image.mjs --input prompt.txt --input-image ref.png
 *   node generate_image.mjs --input prompt.txt --input-image a.png --input-image b.jpg
 *   node generate_image.mjs --input prompt.txt --model sunburst          # GPT Image 2.5 Sunburst
 */

import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// gpt-image-2 is the default. Never omit `model`: the endpoint defaults to
// gpt-image-1.5, not the newest. If this ID 404s, fall back to 'gpt-image-1.5'
// then 'gpt-image-1'. Pass --model to pick another (short aliases below, or
// any full OpenAI model ID such as 'gpt-image-2.5-sunburst-2026-09-08').
const DEFAULT_MODEL = 'gpt-image-2';
const MODEL_ALIASES = {
  'gpt-image-2': 'gpt-image-2',
  sunburst: 'gpt-image-2.5-sunburst',   // GPT Image 2.5 Sunburst
  flare: 'gpt-image-2.5-flare',         // GPT Image 2.5 Flare
  'gpt-image-1.5': 'gpt-image-1.5',
  'gpt-image-1': 'gpt-image-1',
};

// ---------------------------------------------------------------- CLI args
const argv = process.argv.slice(2);
let input = null;
let output = null;
let size = null;
let modelArg = null;
const inputImages = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--input' || a === '-i') input = argv[++i];
  else if (a === '--output' || a === '-o') output = argv[++i];
  else if (a === '--input-image') inputImages.push(argv[++i]);
  else if (a === '--size' || a === '-s') size = argv[++i];
  else if (a === '--model' || a === '-m') modelArg = argv[++i];
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else { usage(); console.error(`\nError: unknown argument "${a}".`); process.exit(1); }
}

function usage() {
  console.log('Usage: node generate_image.mjs --input <prompt.txt> [--output <image.png>] [--size 1536x1024] [--model sunburst] [--input-image <ref.png>]...');
  console.log('  --size: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait). Default: API decides.');
  console.log(`  --model: ${Object.keys(MODEL_ALIASES).join(', ')}, or any full OpenAI model ID. Default: ${DEFAULT_MODEL}.`);
}

const OPENAI_MODEL = modelArg ? (MODEL_ALIASES[modelArg] ?? modelArg) : DEFAULT_MODEL;

if (!input) {
  usage();
  console.error('\nError: --input is required.');
  process.exit(1);
}
if (!output) {
  // Default: same name and location as the input file, with a .png extension.
  output = path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.png`);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Error: OPENAI_API_KEY is not set in the environment.');
  process.exit(1);
}

const prompt = readFileSync(input, 'utf8').trim();
if (!prompt) {
  console.error(`Error: ${input} is empty.`);
  process.exit(1);
}

const missing = inputImages.filter((p) => !existsSync(p));
if (missing.length) {
  console.error(`Error: input image not found: ${missing.join(', ')}`);
  process.exit(1);
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const mimeOf = (file) => MIME[path.extname(file).slice(1).toLowerCase()] ?? 'image/png';

// ---------------------------------------------------------------- generation
// With reference images we edit them; without any we generate from scratch.
async function generate(prompt) {
  let res;
  if (inputImages.length) {
    const form = new FormData();
    form.append('model', OPENAI_MODEL);
    form.append('prompt', prompt);
    if (size) form.append('size', size);
    // The edits endpoint takes a single file as `image`, or several as `image[]`.
    const field = inputImages.length > 1 ? 'image[]' : 'image';
    for (const file of inputImages) {
      form.append(field, new Blob([readFileSync(file)], { type: mimeOf(file) }), path.basename(file));
    }
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        prompt,
        ...(size && { size }),
      }),
    });
  }
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI returned no image: ${JSON.stringify(json).slice(0, 500)}`);
  return Buffer.from(b64, 'base64');
}

// ---------------------------------------------------------------- main
const withRefs = inputImages.length ? ` with ${inputImages.length} reference image${inputImages.length > 1 ? 's' : ''}` : '';
process.stdout.write(`Generating from ${input}${withRefs} via ${OPENAI_MODEL}... `);
try {
  const image = await generate(prompt);
  writeFileSync(output, image);
  const kb = Math.round(statSync(output).size / 1024);
  console.log(`saved ${output} (${kb}KB)`);
} catch (err) {
  console.log('FAILED');
  console.error(err.message);
  process.exit(1);
}
