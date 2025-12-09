const express = require('express');
const crypto = require('crypto');

function createTaskRouter(taskStore, stepDefinitions) {
  const router = express.Router();

  router.post('/api/tasks', async (req, res) => {
    try {
      const taskId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      const type = req.body?.type || 'moments_optimize';
      const payloadJson = JSON.stringify({
        ...(req.body || {}),
        userId: req.user?.sub || null
      });
      await taskStore.createTaskWithSteps({
        id: taskId,
        type,
        payloadJson,
        steps: stepDefinitions
      });
      res.json({ taskId });
    } catch (err) {
      console.error('Create task error:', err.message);
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  router.get('/api/tasks/:id', async (req, res) => {
    try {
      const task = await taskStore.getTaskById(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      const steps = await taskStore.getTaskSteps(req.params.id);
      let parsedResult = null;
      try {
        parsedResult = task.result_json ? JSON.parse(task.result_json) : null;
      } catch (parseErr) {
        console.warn(`Failed to parse result_json for task ${task.id}:`, parseErr.message);
      }
      res.json({
        task: {
          id: task.id,
          type: task.type,
          status: task.status,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          resultJson: parsedResult,
          errorMessage: task.error_message || null
        },
        steps: (steps || []).map((step) => ({
          stepKey: step.step_key,
          stepLabel: step.step_label,
          status: step.status,
          startedAt: step.started_at,
          finishedAt: step.finished_at
        }))
      });
    } catch (err) {
      console.error('Get task status error:', err.message);
      res.status(500).json({ error: 'Failed to fetch task' });
    }
  });

  return router;
}

module.exports = {
  createTaskRouter
};
