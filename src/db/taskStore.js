const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'auth.db');

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

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
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
    try {
      await dbRun('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Task transaction rollback failed:', rollbackErr.message);
    }
    throw err;
  }
}

async function initTaskTables() {
  await dbRun(
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT CHECK(status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED')) NOT NULL,
      payload_json TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await dbRun(
    `CREATE TABLE IF NOT EXISTS task_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      step_key TEXT NOT NULL,
      step_label TEXT NOT NULL,
      status TEXT CHECK(status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED')) NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      extra_json TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )`
  );
  await dbRun(
    'CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps (task_id, step_order)'
  );
  await dbRun(
    'CREATE INDEX IF NOT EXISTS idx_tasks_status_created ON tasks (status, created_at)'
  );
}

async function createTaskWithSteps({ id, type, payloadJson, steps }) {
  const now = new Date().toISOString();
  await runInTransaction(async () => {
    await dbRun(
      `INSERT INTO tasks (id, type, status, payload_json, result_json, error_message, created_at, updated_at)
       VALUES (?, ?, 'PENDING', ?, NULL, NULL, ?, ?)`,
      [id, type, payloadJson, now, now]
    );
    for (const step of steps) {
      await dbRun(
        `INSERT INTO task_steps (task_id, step_order, step_key, step_label, status, started_at, finished_at, extra_json)
         VALUES (?, ?, ?, ?, 'PENDING', NULL, NULL, NULL)`,
        [id, step.stepOrder, step.stepKey, step.stepLabel]
      );
    }
  });
  return id;
}

async function findNextRunnableTask() {
  return dbGet(
    `SELECT *
     FROM tasks
     WHERE status IN ('PENDING', 'RUNNING')
     ORDER BY CASE status WHEN 'RUNNING' THEN 0 ELSE 1 END, datetime(created_at) ASC
     LIMIT 1`
  );
}

async function getTaskById(id) {
  return dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
}

async function getTaskSteps(taskId) {
  return dbAll(
    `SELECT id, task_id, step_order, step_key, step_label, status, started_at, finished_at, extra_json
     FROM task_steps
     WHERE task_id = ?
     ORDER BY step_order ASC`,
    [taskId]
  );
}

async function updateTaskStatus(id, status, errorMessage = null) {
  const now = new Date().toISOString();
  return dbRun(
    'UPDATE tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
    [status, errorMessage, now, id]
  );
}

async function updateTaskResult(id, resultJson) {
  const now = new Date().toISOString();
  return dbRun(
    'UPDATE tasks SET result_json = ?, updated_at = ?, status = ? WHERE id = ?',
    [resultJson, now, 'SUCCESS', id]
  );
}

async function markStepRunning(stepId) {
  const now = new Date().toISOString();
  return dbRun(
    `UPDATE task_steps
     SET status = 'RUNNING', started_at = COALESCE(started_at, ?)
     WHERE id = ?`,
    [now, stepId]
  );
}

async function markStepSuccess(stepId, extra = null) {
  const now = new Date().toISOString();
  return dbRun(
    `UPDATE task_steps
     SET status = 'SUCCESS', finished_at = ?, extra_json = ?
     WHERE id = ?`,
    [now, extra ? JSON.stringify(extra) : null, stepId]
  );
}

async function markStepFailed(stepId, extra = null) {
  const now = new Date().toISOString();
  return dbRun(
    `UPDATE task_steps
     SET status = 'FAILED', finished_at = ?, extra_json = ?
     WHERE id = ?`,
    [now, extra ? JSON.stringify(extra) : null, stepId]
  );
}

async function upsertTaskError(id, message) {
  const now = new Date().toISOString();
  return dbRun(
    'UPDATE tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
    ['FAILED', message, now, id]
  );
}

module.exports = {
  initTaskTables,
  createTaskWithSteps,
  findNextRunnableTask,
  getTaskById,
  getTaskSteps,
  updateTaskStatus,
  updateTaskResult,
  markStepRunning,
  markStepSuccess,
  markStepFailed,
  upsertTaskError
};
