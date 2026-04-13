#!/usr/bin/env node

const { closeDb, createIndexes, getDb } = require('./db');
const { createBatchFromSchedule, getQueueStats } = require('./agents/orchestrator');
const { getPersonaStats } = require('./agents/persona-builder');
const { getPostsByStatus } = require('./agents/content-writer');
const { getReviewStats } = require('./agents/quality-reviewer');
const { runBatch, runDaily, getMetricsSummary } = require('./pipeline');
const { config, logger } = require('../config');

function parseArgs(argv) {
  const args = { command: null, options: {} };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!args.command && !arg.startsWith('--')) {
      args.command = arg;
    } else if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args.options[key] = value;
        i++;
      } else {
        args.options[key] = true;
      }
    }
  }
  return args;
}

async function cmdInit() {
  logger.info('Initializing Reddit Swarm database...');
  await createIndexes();
  logger.info('Database initialized successfully');
  logger.info('Indexes created on: post_queue.status, posts.status, personas.active, metrics.date');
}

async function cmdGenerate(count) {
  const total = parseInt(count, 10) || config.pipeline.postsPerDay;
  logger.info(`Generating ${total} posts...`);

  // Create tasks
  await createBatchFromSchedule(total);

  // Process them
  const results = await runBatch(total);

  console.log('\n=== Generation Results ===');
  console.log(`Total processed: ${results.total}`);
  console.log(`Approved: ${results.approved}`);
  console.log(`Rejected: ${results.rejected}`);
  console.log(`Failed: ${results.failed}`);
  if (results.total > 0) {
    console.log(`Approval rate: ${((results.approved / results.total) * 100).toFixed(1)}%`);
  }
}

async function cmdRun() {
  logger.info('Starting Reddit Swarm in continuous mode...');
  logger.info(`Configured for ${config.pipeline.postsPerDay} posts/day`);
  logger.info('Press Ctrl+C to stop');

  // Run immediately on start
  await runDaily();

  // Schedule next run at 7 AM tomorrow
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(7, 0, 0, 0);
    const delay = next.getTime() - now.getTime();

    logger.info(`Next daily run scheduled at ${next.toISOString()}`);
    setTimeout(async () => {
      try {
        await runDaily();
      } catch (err) {
        logger.error(`Daily run failed: ${err.message}`);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();

  // Keep process alive
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await closeDb();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await closeDb();
    process.exit(0);
  });
}

async function cmdStatus() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     Reddit Swarm — Status Dashboard      ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Queue status
  const queueStats = await getQueueStats();
  console.log('📋 Queue Status:');
  for (const [status, count] of Object.entries(queueStats)) {
    console.log(`   ${status}: ${count}`);
  }
  if (Object.keys(queueStats).length === 0) {
    console.log('   (empty)');
  }
  console.log();

  // Review stats
  const reviewStats = await getReviewStats();
  console.log('📝 Posts:');
  for (const [status, data] of Object.entries(reviewStats)) {
    const scoreStr = data.avgScore != null ? ` (avg score: ${data.avgScore})` : '';
    console.log(`   ${status}: ${data.count}${scoreStr}`);
  }
  if (Object.keys(reviewStats).length === 0) {
    console.log('   (no posts yet)');
  }
  console.log();

  // Persona stats
  const personaStats = await getPersonaStats();
  console.log('👤 Personas:');
  console.log(`   Total active: ${personaStats.total}`);
  if (Object.keys(personaStats.byLanguage).length > 0) {
    console.log(`   By language: ${JSON.stringify(personaStats.byLanguage)}`);
  }
  if (Object.keys(personaStats.byLevel).length > 0) {
    console.log(`   By level: ${JSON.stringify(personaStats.byLevel)}`);
  }
  console.log();

  // Metrics
  const metrics = await getMetricsSummary();
  console.log('📊 Metrics:');
  console.log(`   Today: ${metrics.today.approved}/${metrics.today.generated} approved (${((metrics.today.approval_rate || 0) * 100).toFixed(1)}%)`);
  console.log(`   This week: ${metrics.week.approved}/${metrics.week.generated} approved`);
  if (metrics.today.avg_quality_score) {
    console.log(`   Avg quality score: ${metrics.today.avg_quality_score}`);
  }
  console.log();
}

async function cmdExport(status, outputPath) {
  const filterStatus = status || 'approved';
  const posts = await getPostsByStatus(filterStatus, 1000);

  if (posts.length === 0) {
    console.log(`No posts with status "${filterStatus}" found.`);
    return;
  }

  const exportData = posts.map((p) => ({
    post_id: p.post_id,
    title: p.title,
    body: p.body,
    comments: p.comments,
    subreddit: p.params?.subreddit,
    feature: p.params?.feature,
    quality_score: p.quality_score,
    status: p.status,
    created_at: p.created_at,
    reviewed_at: p.reviewed_at,
  }));

  const fs = require('fs');
  const path = require('path');
  const outFile = outputPath || path.join(process.cwd(), `export-${filterStatus}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2));
  console.log(`Exported ${posts.length} posts to ${outFile}`);
}

function printHelp() {
  console.log(`
Reddit Swarm Agent System v1.0

Usage: node src/index.js <command> [options]

Commands:
  init              Initialize database (create indexes)
  generate [N]      Generate N posts (default: ${config.pipeline.postsPerDay})
  run               Start continuous mode (daily generation on schedule)
  status            Show dashboard with queue, posts, and metrics
  export            Export posts as JSON

Options:
  --count N         Number of posts to generate (default: ${config.pipeline.postsPerDay})
  --status STATUS   Filter by status for export (default: approved)
  --output PATH     Output file path for export

Examples:
  node src/index.js init
  node src/index.js generate --count 5
  node src/index.js run
  node src/index.js status
  node src/index.js export --status approved --output ./my-posts.json
`);
}

async function main() {
  const { command, options } = parseArgs(process.argv);

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'init':
        await cmdInit();
        break;

      case 'generate':
        await cmdGenerate(options.count);
        break;

      case 'run':
        await cmdRun();
        break;

      case 'status':
        await cmdStatus();
        break;

      case 'export':
        await cmdExport(options.status, options.output);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    logger.error(`Command failed: ${err.message}`);
    logger.debug(err.stack);
    process.exit(1);
  } finally {
    // Only close DB for non-continuous commands
    if (command !== 'run') {
      await closeDb();
    }
  }
}

main();
