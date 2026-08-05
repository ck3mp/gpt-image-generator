#!/usr/bin/env node
/**
 * Generate an image from a text prompt via the OpenAI image API.
 *
 * Reads the prompt from a .txt file and saves the generated image as a PNG,
 * exactly as returned by the API — no resizing, no size caps.
 *
 * Requires OPENAI_API_KEY. Uses OpenAI's top image model (see OPENAI_MODEL
 * below); GPT Image models are paid-only and need org verification.
 *
 * Usage:
 *   node generate_image.mjs --input prompt.txt                    # saves prompt.png
 *   node generate_image.mjs --input prompt.txt --output out.png   # custom output path
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

// gpt-image-2 is OpenAI's flagship image model (supersedes gpt-image-1.5 and
// gpt-image-1). Never omit `model`: the endpoint defaults to gpt-image-1.5,
// not the newest. If this ID 404s, fall back to 'gpt-image-1.5' then 'gpt-image-1'.
const OPENAI_MODEL = 'gpt-image-2';

// ---------------------------------------------------------------- CLI args
const argv = process.argv.slice(2);
let input = null;
let output = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--input' || a === '-i') input = argv[++i];
  else if (a === '--output' || a === '-o') output = argv[++i];
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else { usage(); console.error(`\nError: unknown argument "${a}".`); process.exit(1); }
}

function usage() {
  console.log('Usage: node generate_image.mjs --input <prompt.txt> [--output <image.png>]');
}

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

// ---------------------------------------------------------------- generation
async function generate(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI returned no image: ${JSON.stringify(json).slice(0, 500)}`);
  return Buffer.from(b64, 'base64');
}

// ---------------------------------------------------------------- main
process.stdout.write(`Generating from ${input} via ${OPENAI_MODEL}... `);
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
