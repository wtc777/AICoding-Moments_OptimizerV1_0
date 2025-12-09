const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
const sharp = require('sharp');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'auth.db');
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'public', 'prompts');
const VISION_SYS_PROMPT_PATH = path.join(PROMPTS_DIR, 'VISION_SYSTEM_PROMPT.txt');
const DEFAULT_VISION_SYSTEM_PROMPT =
  'You are an image fact-extraction assistant. Describe only what is strictly visible in the image: objects, people, actions, text, numbers, colors, and spatial layout.';

const BASE_URL =
  process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_KEY = process.env.DASHSCOPE_API_KEY;
const TEXT_MODEL = process.env.TEXT_MODEL || 'qwen-plus';
const VISION_MODEL = process.env.VISION_MODEL || 'qwen-vl-plus';

if (!API_KEY) {
  console.warn('[TaskLogic] DASHSCOPE_API_KEY is missing.');
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_FILE);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function runInTransaction(fn) {
  await dbRun('BEGIN');
  try {
    const result = await fn();
    await dbRun('COMMIT');
    return result;
  } catch (err) {
    await dbRun('ROLLBACK');
    throw err;
  }
}

async function consumeCreditAndLog(userId, type, durationMs) {
  const now = new Date().toISOString();
  await runInTransaction(async () => {
    const result = await dbRun(
      'UPDATE users SET credits = credits - 1, updated_at = ? WHERE id = ? AND credits > 0',
      [now, userId]
    );
    if (!result || result.changes === 0) {
      const err = new Error('INSUFFICIENT_CREDITS');
      err.code = 'INSUFFICIENT_CREDITS';
      throw err;
    }
    await dbRun(
      'INSERT INTO analysis_logs (id, user_id, type, created_at, duration_ms) VALUES (?, ?, ?, ?, ?)',
      [
        crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        userId,
        type,
        now,
        durationMs ?? null
      ]
    );
  });
  const refreshed = await dbGet('SELECT credits FROM users WHERE id = ?', [userId]);
  return refreshed?.credits;
}

async function recordHistory({
  userId,
  inputText,
  outputText,
  imagePath,
  durationMs,
  usage,
  modelName,
  success = true,
  errorMessage
}) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  await dbRun(
    `INSERT INTO analysis_history (
      id, user_id, created_at, image_path, input_text, output_text,
      duration_ms, input_tokens, output_tokens, total_tokens, model_name, success, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      now,
      imagePath || '',
      inputText || '',
      outputText || '',
      durationMs ?? null,
      usage?.input_tokens ?? null,
      usage?.output_tokens ?? null,
      usage?.total_tokens ?? null,
      modelName || null,
      success ? 1 : 0,
      errorMessage || null
    ]
  );
}

function readScenarioPrompt() {
  const fileName = 'MOMENT_SCENARIO.txt';
  const scenarioPath = path.join(PROMPTS_DIR, fileName);
  try {
    if (fs.existsSync(scenarioPath)) {
      return fs.readFileSync(scenarioPath, 'utf8').trim();
    }
  } catch (err) {
    console.warn('[TaskLogic] Failed to read scenario prompt:', err.message);
  }
  return '';
}

function readVisionSystemPrompt() {
  try {
    if (fs.existsSync(VISION_SYS_PROMPT_PATH)) {
      return fs.readFileSync(VISION_SYS_PROMPT_PATH, 'utf8').trim();
    }
  } catch (err) {
    console.warn('[TaskLogic] Read vision prompt failed:', err.message);
  }
  return DEFAULT_VISION_SYSTEM_PROMPT;
}

async function callDashScopeChat(model, messages) {
  const url = `${BASE_URL}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({ model, messages })
  });
  const result = await response.json();
  if (!response.ok) {
    const errorMessage = result?.error?.message || 'Unexpected response from DashScope';
    throw new Error(errorMessage);
  }
  const reply = Array.isArray(result?.choices?.[0]?.message?.content)
    ? result.choices[0].message.content.map((c) => c.text || '').join('\n').trim()
    : (result?.choices?.[0]?.message?.content || '').trim();
  if (!reply) {
    throw new Error('No reply content returned from DashScope.');
  }
  return {
    reply,
    usage: {
      input_tokens: result?.usage?.input_tokens ?? null,
      output_tokens: result?.usage?.output_tokens ?? null,
      total_tokens: result?.usage?.total_tokens ?? null
    }
  };
}

async function saveThumbnailFromBase64(base64, userId) {
  if (!sharp || !base64) return '';
  try {
    const [meta, data] = base64.split(',');
    const buffer = Buffer.from(data || base64, 'base64');
    fs.mkdirSync(path.join(__dirname, '..', '..', 'public', 'uploads', 'thumbnails'), {
      recursive: true
    });
    const filename = `${Date.now()}-${userId || 'anon'}.jpg`;
    const filepath = path.join(__dirname, '..', '..', 'public', 'uploads', 'thumbnails', filename);
    await sharp(buffer)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(filepath);
    return `/uploads/thumbnails/${filename}`;
  } catch (err) {
    console.error('[TaskLogic] Save thumbnail failed:', err.message);
    return '';
  }
}

async function runImageModel({ imageBase64 }) {
  const visionSystemPrompt = readVisionSystemPrompt();
  const imageUrl =
    imageBase64 && imageBase64.startsWith('data:') && imageBase64.includes('base64,')
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;
  const messages = [
    {
      role: 'system',
      content: [{ type: 'text', text: visionSystemPrompt }]
    },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: imageUrl } }]
    }
  ];
  const res = await callDashScopeChat(VISION_MODEL, messages);
  return {
    summary: res.reply,
    usage: res.usage
  };
}

async function runTextModel({ combinedPrompt }) {
  const scenarioPrompt = readScenarioPrompt();
  const messages = [
    ...(scenarioPrompt
      ? [
          {
            role: 'system',
            content: [{ type: 'text', text: scenarioPrompt }]
          }
        ]
      : []),
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text: 'You are a helpful assistant that reasons over text and extracted image details.'
        }
      ]
    },
    {
      role: 'user',
      content: [{ type: 'text', text: combinedPrompt }]
    }
  ];
  const res = await callDashScopeChat(TEXT_MODEL, messages);
  return { reply: res.reply, usage: res.usage };
}

async function finalizeAndPersist({ userId, inputText, outputText, imageBase64, visionSummary, textUsage }) {
  const duration = null;
  let thumbPath = '';
  if (imageBase64) {
    thumbPath = await saveThumbnailFromBase64(imageBase64, userId);
  }
  if (userId) {
    try {
      await consumeCreditAndLog(userId, 'image', duration);
      await recordHistory({
        userId,
        inputText,
        outputText,
        imagePath: thumbPath,
        durationMs: duration,
        usage: textUsage,
        modelName: TEXT_MODEL,
        success: true
      });
    } catch (err) {
      console.warn('[TaskLogic] Record history/credits failed:', err.message);
    }
  }
  return {
    optimizedText: outputText,
    visionSummary,
    thumbPath
  };
}

module.exports = {
  runImageModel,
  runTextModel,
  finalizeAndPersist
};
