const { getDb } = require('./db');
const { createBatchFromSchedule, getNextTask, markTaskProcessing, markTaskDone, markTaskFailed } = require('./agents/orchestrator');
const { getOrCreatePersona, incrementPersonaPostCount } = require('./agents/persona-builder');
const { writePost } = require('./agents/content-writer');
const { reviewPost } = require('./agents/quality-reviewer');
const { config, logger } = require('../config');

/**
 * Run a single task through the full pipeline:
 * 1. Pick next pending task
 * 2. Assign a persona
 * 3. Write the post
 * 4. Review for quality
 * 5. Update metrics
 */
async function runOne() {
  // 1. Get next task
  const task = await getNextTask();
  if (!task) {
    logger.debug('No pending tasks in queue');
    return null;
  }

  logger.info(`=== Pipeline: Processing task ${task.task_id} ===`);
  await markTaskProcessing(task.task_id);

  try {
    // 2. Assign persona
    const persona = await getOrCreatePersona(task.params);

    // Update task with persona
    const db = await getDb();
    await db.collection('post_queue').updateOne(
      { task_id: task.task_id },
      { $set: { persona_id: persona.persona_id } }
    );

    // 3. Write post
    const post = await writePost(task, persona);

    // 4. Review post
    const review = await reviewPost(post);

    // 5. Update persona post count
    await incrementPersonaPostCount(persona.persona_id);

    // 6. Mark task done
    await markTaskDone(task.task_id);

    logger.info(
      `=== Pipeline: Task ${task.task_id} complete — post ${review.approved ? 'APPROVED' : 'REJECTED'} (score: ${review.score}) ===`
    );

    return { task, persona, post, review };
  } catch (err) {
    await markTaskFailed(task.task_id, err);
    logger.error(`Pipeline failed for task ${task.task_id}: ${err.message}`);
    return { task, error: err };
  }
}

/**
 * Run a batch of tasks sequentially.
 */
async function runBatch(count) {
  const total = count || config.pipeline.postsPerDay;
  logger.info(`Starting batch of ${total} tasks`);

  const results = {
    total: 0,
    approved: 0,
    rejected: 0,
    failed: 0,
    posts: [],
  };

  for (let i = 0; i < total; i++) {
    logger.info(`--- Batch progress: ${i + 1}/${total} ---`);
    const result = await runOne();

    if (!result) {
      logger.info('No more tasks to process — batch complete');
      break;
    }

    results.total++;
    if (result.error) {
      results.failed++;
    } else if (result.review?.approved) {
      results.approved++;
      results.posts.push(result);
    } else {
      results.rejected++;
      results.posts.push(result);
    }

    // Small delay between tasks to avoid rate limiting
    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Update daily metrics
  await updateMetrics(results);

  logger.info(
    `Batch complete: ${results.total} processed, ${results.approved} approved, ${results.rejected} rejected, ${results.failed} failed`
  );

  return results;
}

/**
 * Run daily batch: create tasks then process them.
 */
async function runDaily(count) {
  const total = count || config.pipeline.postsPerDay;
  logger.info(`=== Starting daily run for ${total} posts ===`);

  // Step 1: Create tasks
  await createBatchFromSchedule(total);

  // Step 2: Process all tasks
  const results = await runBatch(total);

  logger.info(`=== Daily run complete ===`);
  return results;
}

/**
 * Update the metrics collection with today's results.
 */
async function updateMetrics(batchResults) {
  const db = await getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const generated = batchResults.total || 0;
  const approved = batchResults.approved || 0;
  const rejected = (batchResults.rejected || 0) + (batchResults.failed || 0);
  const approvalRate = generated > 0 ? approved / generated : 0;

  // Calculate average quality score from posts
  let totalScore = 0;
  let scoreCount = 0;
  for (const r of batchResults.posts || []) {
    if (r.review?.score != null) {
      totalScore += r.review.score;
      scoreCount++;
    }
  }
  const avgScore = scoreCount > 0 ? totalScore / scoreCount : 0;

  await db.collection('metrics').updateOne(
    { date: today },
    {
      $set: {
        generated,
        approved,
        rejected,
        approval_rate: Math.round(approvalRate * 1000) / 1000,
        avg_quality_score: Math.round(avgScore * 1000) / 1000,
      },
      $setOnInsert: {
        date: today,
      },
    },
    { upsert: true }
  );

  logger.info(`Metrics updated: ${approved}/${generated} approved (${(approvalRate * 100).toFixed(1)}%), avg score: ${avgScore.toFixed(3)}`);
}

/**
 * Get current metrics summary.
 */
async function getMetricsSummary() {
  const db = await getDb();

  // Today's metrics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMetrics = await db.collection('metrics').findOne({ date: today });

  // Last 7 days
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekMetrics = await db
    .collection('metrics')
    .find({ date: { $gte: weekAgo } })
    .sort({ date: -1 })
    .toArray();

  const weekTotals = weekMetrics.reduce(
    (acc, m) => ({
      generated: acc.generated + (m.generated || 0),
      approved: acc.approved + (m.approved || 0),
      rejected: acc.rejected + (m.rejected || 0),
    }),
    { generated: 0, approved: 0, rejected: 0 }
  );

  return {
    today: todayMetrics || { generated: 0, approved: 0, rejected: 0, approval_rate: 0, avg_quality_score: 0 },
    week: weekTotals,
    dailyBreakdown: weekMetrics,
  };
}

module.exports = {
  runOne,
  runBatch,
  runDaily,
  getMetricsSummary,
};
