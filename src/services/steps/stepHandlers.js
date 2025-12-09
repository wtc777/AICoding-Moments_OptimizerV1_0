const { runImageModel, runTextModel, finalizeAndPersist } = require('../../worker/taskLogic');

const defaultSteps = [
  { stepOrder: 1, stepKey: 'image_processing', stepLabel: 'Image processing' },
  { stepOrder: 2, stepKey: 'image_model_call', stepLabel: 'Image model call' },
  { stepOrder: 3, stepKey: 'image_result_saved', stepLabel: 'Image result saved' },
  { stepOrder: 4, stepKey: 'prompt_building', stepLabel: 'Prompt building' },
  { stepOrder: 5, stepKey: 'llm_call', stepLabel: 'LLM call' },
  { stepOrder: 6, stepKey: 'final_result', stepLabel: 'Final result' }
];

async function runImageProcessingStep(context) {
  const imageBase64 = context.payload?.imageBase64 || '';
  if (!imageBase64) {
    throw new Error('Image is required for processing');
  }
  return { updates: { imageBase64 }, extra: {} };
}

async function runImageModelCallStep(context) {
  const { summary, usage } = await runImageModel({ imageBase64: context.imageBase64 });
  return {
    updates: { visionSummary: summary },
    extra: { usage }
  };
}

async function saveImageResultStep(context) {
  return {
    updates: { savedImageResult: { summary: context.visionSummary || '' } },
    extra: {}
  };
}

async function buildPromptStep(context) {
  const userText = context.payload?.userText || '';
  const prompt = [
    'Below are the user text and image analysis:',
    `User text:${userText}`,
    `Image analysis:${context.visionSummary || ''}`
  ].join('\n');
  return { updates: { prompt }, extra: {} };
}

async function runTextModelCallStep(context) {
  const { reply, usage } = await runTextModel({ combinedPrompt: context.prompt });
  return {
    updates: { textResult: reply, textUsage: usage },
    extra: { usage }
  };
}

async function finalizeResultStep(context) {
  const finalResult = await finalizeAndPersist({
    userId: context.payload?.userId,
    inputText: context.payload?.userText || '',
    outputText: context.textResult || '',
    imageBase64: context.imageBase64,
    visionSummary: context.visionSummary || '',
    textUsage: context.textUsage
  });
  return { updates: { finalResult }, extra: {} };
}

function buildStepHandlers() {
  return {
    image_processing: runImageProcessingStep,
    image_model_call: runImageModelCallStep,
    image_result_saved: saveImageResultStep,
    prompt_building: buildPromptStep,
    llm_call: runTextModelCallStep,
    final_result: finalizeResultStep
  };
}

module.exports = {
  defaultSteps,
  buildStepHandlers
};
