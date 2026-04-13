const { getDb } = require('../db');
const { chatJSON } = require('../llm');
const { buildReviewerPrompt } = require('../../dna/system-prompt');
const { config, logger } = require('../../config');

/**
 * Programmatic checks that can be validated without LLM.
 * Returns an array of issue strings. Empty array means all checks pass.
 */
function programmaticChecks(post) {
  const issues = [];
  const APP_NAMES = ['iron kinetic', 'ironkinetic', 'iron_kinetic', 'iron-kinetic'];

  // 1. App name in title
  var titleLower = (post.title || '').toLowerCase();
  for (var i = 0; i < APP_NAMES.length; i++) {
    if (titleLower.indexOf(APP_NAMES[i]) !== -1) {
      issues.push('App name "' + APP_NAMES[i] + '" found in title - automatic rejection');
      break;
    }
  }

  // 2. Bullet points in body (lines starting with - or * or numbered list)
  var body = post.body || '';
  var bulletPattern = /^\s*[-*•]\s/m;
  var numberedListPattern = /^\s*\d+\.\s/m;
  if (bulletPattern.test(body) || numberedListPattern.test(body)) {
    issues.push('Body contains bullet points or numbered lists - violates DNA rules');
  }

  // 3. Specific numbers present
  var hasNumbers = /\d+\s*(kg|lbs?|pounds?|kilos?|months?|weeks?|days?|calories?|kcal)/i.test(body);
  if (!hasNumbers) {
    issues.push('No specific weight/time measurements found - posts must include concrete numbers');
  }

  // 4. App name mentioned more than once in body
  var appMentions = 0;
  for (var j = 0; j < APP_NAMES.length; j++) {
    var regex = new RegExp(APP_NAMES[j], 'gi');
    var matches = body.match(regex);
    if (matches) appMentions += matches.length;
  }
  if (appMentions > 1) {
    issues.push('App name mentioned ' + appMentions + ' times in body - maximum 1 allowed');
  }

  // 5. Referral link as CTA
  var ctaPatterns = [/click here/i, /sign up (here|now|today)/i, /use my (link|code)/i, /join (now|today|here)/i, /get started (now|here|today)/i];
  for (var k = 0; k < ctaPatterns.length; k++) {
    if (ctaPatterns[k].test(body)) {
      issues.push('Possible CTA detected - referral must be natural, not a call-to-action');
    }
  }

  // 6. Title too promotional
  var promoTitlePatterns = [/amazing/i, /incredible/i, /you won'?t believe/i, /must try/i, /game.?changer/i, /best (app|tool|program)/i];
  for (var m = 0; m < promoTitlePatterns.length; m++) {
    if (promoTitlePatterns[m].test(post.title || '')) {
      issues.push('Title sounds promotional');
    }
  }

  // 7. Post too short
  if (body.length < 100) {
    issues.push('Body too short (' + body.length + ' chars) - minimum 100 characters for authenticity');
  }

  return issues;
}

/**
 * Use LLM for subjective quality evaluation.
 */
async function llmReview(post) {
  var reviewerPrompt = buildReviewerPrompt();

  var userMessage = 'Review this Reddit post for quality and authenticity:\n\n'
    + '## Post Details\n'
    + 'Title: ' + (post.title || '') + '\n'
    + 'Subreddit: ' + ((post.params && post.params.subreddit) || 'unknown') + '\n'
    + 'Feature: ' + ((post.params && post.params.feature) || 'unknown') + '\n\n'
    + '## Post Body\n'
    + (post.body || '') + '\n\n';

  if (post.comments && post.comments.length > 0) {
    userMessage += '## Comments\n';
    for (var i = 0; i < post.comments.length; i++) {
      userMessage += 'Q: ' + post.comments[i].trigger + '\nA: ' + post.comments[i].response + '\n\n';
    }
  }

  userMessage += 'Evaluate authenticity, specificity, tone compliance, and subreddit fit. Return the JSON with score, approved, and notes.';

  var review = await chatJSON(reviewerPrompt, userMessage);
  return {
    approved: review.approved === true,
    score: typeof review.score === 'number' ? review.score : 0.5,
    notes: Array.isArray(review.notes) ? review.notes : [],
    issues: Array.isArray(review.issues) ? review.issues : [],
  };
}

/**
 * Full review pipeline: programmatic checks + LLM evaluation.
 * Updates the post in DB with review results.
 */
async function reviewPost(post) {
  logger.info('Reviewing post ' + post.post_id + ' - "' + (post.title || '').substring(0, 50) + '..."');

  // Step 1: Programmatic checks
  var autoIssues = programmaticChecks(post);

  // If critical auto-fail issues found, reject immediately
  var hasAutoReject = false;
  for (var i = 0; i < autoIssues.length; i++) {
    if (autoIssues[i].indexOf('automatic rejection') !== -1) {
      hasAutoReject = true;
      break;
    }
  }

  if (hasAutoReject) {
    var result = {
      approved: false,
      score: 0,
      notes: ['Automatic rejection - critical DNA rule violation'],
      issues: autoIssues,
    };

    await updatePostStatus(post.post_id, 'rejected', result);
    logger.warn('Post ' + post.post_id + ' AUTO-REJECTED: ' + autoIssues[0]);
    return result;
  }

  // Step 2: LLM review for subjective quality
  var llmResult;
  try {
    llmResult = await llmReview(post);
  } catch (err) {
    logger.error('LLM review failed for post ' + post.post_id + ': ' + err.message);
    llmResult = {
      approved: false,
      score: 0,
      notes: ['LLM review failed: ' + err.message],
      issues: [],
    };
  }

  // Combine results
  var allNotes = [];
  for (var j = 0; j < autoIssues.length; j++) {
    allNotes.push('[AUTO] ' + autoIssues[j]);
  }
  for (var k = 0; k < llmResult.notes.length; k++) {
    allNotes.push(llmResult.notes[k]);
  }

  var allIssues = autoIssues.concat(llmResult.issues);
  var finalScore = Math.max(0, Math.min(1, llmResult.score));
  var threshold = config.pipeline.qualityThreshold;

  // Determine approval: LLM must approve AND score above threshold AND no auto issues
  var approved = llmResult.approved && finalScore >= threshold && autoIssues.length === 0;

  var finalResult = {
    approved: approved,
    score: Math.round(finalScore * 1000) / 1000,
    notes: allNotes,
    issues: allIssues,
  };

  // Update post in database
  await updatePostStatus(post.post_id, approved ? 'approved' : 'rejected', finalResult);

  logger.info(
    'Post ' + post.post_id + ' ' + (approved ? 'APPROVED' : 'REJECTED')
    + ' - score: ' + finalScore.toFixed(3)
    + ' (' + allNotes.length + ' notes, ' + allIssues.length + ' issues)'
  );

  return finalResult;
}

async function updatePostStatus(postId, status, reviewResult) {
  var db = await getDb();
  await db.collection('posts').updateOne(
    { post_id: postId },
    {
      $set: {
        status: status,
        quality_score: reviewResult.score,
        review_notes: reviewResult.notes,
        reviewed_at: new Date(),
      },
    }
  );
}

/**
 * Get review statistics.
 */
async function getReviewStats() {
  var db = await getDb();
  var pipeline = [
    { $group: { _id: '$status', count: { $sum: 1 }, avgScore: { $avg: '$quality_score' } } },
  ];
  var stats = await db.collection('posts').aggregate(pipeline).toArray();
  var result = {};
  for (var i = 0; i < stats.length; i++) {
    result[stats[i]._id] = {
      count: stats[i].count,
      avgScore: stats[i].avgScore ? Math.round(stats[i].avgScore * 1000) / 1000 : null,
    };
  }
  return result;
}

module.exports = {
  reviewPost: reviewPost,
  programmaticChecks: programmaticChecks,
  getReviewStats: getReviewStats,
};
