const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { config, logger } = require('../../config');

const FEATURES = ['referral', 'predictive_curve', 'meal_plan', 'check_in', 'subscription', 'generic_progress'];
const ANGLES = { referral: ['A', 'B', 'C'], predictive_curve: ['A', 'B', 'C'], meal_plan: ['A', 'B', 'C'], check_in: ['A', 'B'], subscription: ['A', 'B'], generic_progress: ['A'] };
const SUBREDDITS_EN = ['r/loseit', 'r/progresspics', 'r/fitness', 'r/nutrition'];
const SUBREDDIT_IT = ['r/italy'];
const TONES_EN = ['motivational', 'practical', 'surprised', 'reflective'];
const TONES_IT = ['motivazionale', 'pratico', 'sorpreso', 'riflessivo'];
const LENGTHS = ['short', 'medium', 'long'];

// Distribution: 40% en subreddits, 30% r/loseit+progresspics, 20% r/fitness+nutrition, 10% r/italy
const SUBREDDIT_WEIGHTS = [
  { subreddit: 'r/loseit', weight: 20 },
  { subreddit: 'r/progresspics', weight: 15 },
  { subreddit: 'r/fitness', weight: 12 },
  { subreddit: 'r/nutrition', weight: 8 },
  { subreddit: 'r/italy', weight: 10 },
  // Extra weight to loseit+progresspics to hit 30%
  { subreddit: 'r/loseit', weight: 10 },
  { subreddit: 'r/progresspics', weight: 10 },
  // Extra weight to fitness+nutrition to hit 20%
  { subreddit: 'r/fitness', weight: 5 },
  { subreddit: 'r/nutrition', weight: 5 },
];

function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item.subreddit;
  }
  return items[items.length - 1].subreddit;
}

async function createTask(params) {
  const db = await getDb();
  const task = {
    task_id: uuidv4(),
    status: 'pending',
    params: {
      feature: params.feature || 'generic_progress',
      language: params.language || 'en',
      angle: params.angle || 'A',
      subreddit: params.subreddit || 'r/loseit',
      tone: params.tone || 'practical',
      length: params.length || 'medium',
      include_comments: params.include_comments !== undefined ? params.include_comments : true,
    },
    persona_id: params.persona_id || null,
    priority: params.priority || 5,
    scheduled_for: params.scheduled_for || new Date(),
    created_at: new Date(),
    completed_at: null,
  };

  await db.collection('post_queue').insertOne(task);
  logger.info(`Created task ${task.task_id} — ${task.params.feature}/${task.params.angle} → ${task.params.subreddit}`);
  return task;
}

async function createBatchFromSchedule(count) {
  const total = count || config.pipeline.postsPerDay;
  const tasks = [];

  for (let i = 0; i < total; i++) {
    const subreddit = weightedRandom(SUBREDDIT_WEIGHTS);
    const isItalian = subreddit === 'r/italy';
    const language = isItalian ? 'it' : 'en';
    const feature = FEATURES[i % FEATURES.length];
    const availableAngles = ANGLES[feature] || ['A'];
    const angle = availableAngles[i % availableAngles.length];
    const tones = isItalian ? TONES_IT : TONES_EN;
    const tone = tones[i % tones.length];
    const subredditLengths = { 'r/progresspics': 'short', 'r/loseit': 'medium', 'r/fitness': 'long', 'r/nutrition': 'medium', 'r/italy': 'medium' };
    const length = subredditLengths[subreddit] || 'medium';

    // Stagger scheduled times across the day
    const scheduledFor = new Date();
    const hourOffset = Math.floor((i / total) * 16) + 7; // spread between 7:00 and 23:00
    scheduledFor.setHours(hourOffset, Math.floor(Math.random() * 60), 0, 0);

    const task = await createTask({
      feature,
      language,
      angle,
      subreddit,
      tone,
      length,
      include_comments: Math.random() > 0.3, // 70% include comments
      priority: Math.floor(Math.random() * 3) + 4, // 4-6
      scheduled_for: scheduledFor,
    });
    tasks.push(task);
  }

  logger.info(`Created batch of ${tasks.length} tasks`);
  return tasks;
}

async function getNextTask() {
  const db = await getDb();
  const task = await db
    .collection('post_queue')
    .findOne(
      { status: 'pending', scheduled_for: { $lte: new Date() } },
      { sort: { priority: -1, scheduled_for: 1 } }
    );
  return task;
}

async function markTaskProcessing(taskId) {
  const db = await getDb();
  await db.collection('post_queue').updateOne(
    { task_id: taskId },
    { $set: { status: 'processing' } }
  );
}

async function markTaskDone(taskId) {
  const db = await getDb();
  await db.collection('post_queue').updateOne(
    { task_id: taskId },
    { $set: { status: 'done', completed_at: new Date() } }
  );
  logger.info(`Task ${taskId} marked done`);
}

async function markTaskFailed(taskId, error) {
  const db = await getDb();
  await db.collection('post_queue').updateOne(
    { task_id: taskId },
    { $set: { status: 'failed', completed_at: new Date(), error: error?.message || String(error) } }
  );
  logger.error(`Task ${taskId} failed: ${error?.message || error}`);
}

async function getQueueStats() {
  const db = await getDb();
  const pipeline = [
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ];
  const stats = await db.collection('post_queue').aggregate(pipeline).toArray();
  const result = {};
  for (const s of stats) {
    result[s._id] = s.count;
  }
  return result;
}

module.exports = {
  createTask,
  createBatchFromSchedule,
  getNextTask,
  markTaskProcessing,
  markTaskDone,
  markTaskFailed,
  getQueueStats,
};
