const { buildStepHandlers } = require('../services/steps/stepHandlers');

function safeParse(jsonStr) {
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.warn('Failed to parse task payload:', err.message);
    return null;
  }
}

function startTaskWorker(taskStore, options = {}) {
  const intervalMs = options.intervalMs || 1000;
  const stepHandlers = options.stepHandlers || buildStepHandlers();
  let isRunning = false;

  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const task = await taskStore.findNextRunnableTask();
      if (!task) return;

      const steps = await taskStore.getTaskSteps(task.id);
      if (!steps || steps.length === 0) {
        await taskStore.upsertTaskError(task.id, 'No steps defined for task');
        return;
      }

      if (task.status === 'PENDING') {
        await taskStore.updateTaskStatus(task.id, 'RUNNING', null);
      }

      const context = {
        taskId: task.id,
        payload: safeParse(task.payload_json) || {}
      };

      for (const step of steps) {
        if (step.status === 'SUCCESS') continue;
        const handler = stepHandlers[step.step_key];
        if (!handler) {
          console.error(`[TaskWorker] Missing handler for step ${step.step_key}`);
          await taskStore.markStepFailed(step.id, { error: 'Handler missing' });
          await taskStore.upsertTaskError(task.id, `Handler missing for ${step.step_key}`);
          return;
        }
        await taskStore.markStepRunning(step.id);
        try {
          const result = await handler(context);
          if (result && result.updates) {
            Object.assign(context, result.updates);
          }
          await taskStore.markStepSuccess(step.id, result?.extra || null);
        } catch (err) {
          console.error(`[TaskWorker] Step ${step.step_key} failed:`, err.message);
          await taskStore.markStepFailed(step.id, { error: err.message || 'Step failed' });
          await taskStore.upsertTaskError(task.id, err.message || 'Step failed');
          return;
        }
      }

      const finalResult =
        context.finalResult ||
        {
          visionSummary: context.visionSummary || '',
          optimizedText: context.textResult || '',
          prompt: context.prompt || '',
          payload: context.payload || {}
        };
      await taskStore.updateTaskResult(task.id, JSON.stringify(finalResult));
    } catch (err) {
      console.error('[TaskWorker] Loop error:', err.message);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  console.log(`[TaskWorker] Started with interval ${intervalMs}ms`);
}

module.exports = {
  startTaskWorker
};
