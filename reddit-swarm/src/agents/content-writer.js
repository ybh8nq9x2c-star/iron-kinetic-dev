const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { chatJSON } = require('../llm');
const { buildSystemPrompt } = require('../../dna/system-prompt');
const { logger } = require('../../config');

/**
 * Write a Reddit post using the DNA system prompt + persona context + task params.
 * Returns the structured post object and inserts it into the posts collection.
 */
async function writePost(task, persona) {
  logger.info('Writing post for task ' + task.task_id + ' as persona ' + persona.name);

  const systemPrompt = buildSystemPrompt(persona, task.params);

  const userMessage = 'Write a Reddit post for ' + task.params.subreddit + ' about your experience.\n\n'
    + 'Feature focus: ' + task.params.feature + '\n'
    + 'Angle: ' + task.params.angle + '\n'
    + 'Tone: ' + task.params.tone + '\n'
    + 'Length: ' + task.params.length + '\n\n'
    + 'Remember:\n'
    + '- You are ' + persona.name + ', a real person sharing a genuine experience\n'
    + '- Use specific numbers from your journey (' + persona.starting_weight_kg + 'kg to ' + persona.current_weight_kg + 'kg)\n'
    + '- Include at least one moment of honesty or doubt\n'
    + '- Keep paragraphs short, no bullet points\n'
    + '- ' + (task.params.include_comments ? 'Include 2-3 simulated comments with your responses' : 'No comments needed') + '\n\n'
    + 'Return the JSON with title, body, and comments array.';

  const llmResponse = await chatJSON(systemPrompt, userMessage);

  // Validate and normalize the response
  const post = {
    post_id: uuidv4(),
    task_id: task.task_id,
    persona_id: persona.persona_id,
    status: 'draft',
    title: llmResponse.title || '',
    body: llmResponse.body || '',
    comments: Array.isArray(llmResponse.comments) ? llmResponse.comments : [],
    params: task.params,
    quality_score: null,
    review_notes: [],
    created_at: new Date(),
    reviewed_at: null,
  };

  // Basic validation before storing
  if (!post.title || post.title.length < 10) {
    throw new Error('Generated post title too short or empty: "' + post.title + '"');
  }
  if (!post.body || post.body.length < 50) {
    throw new Error('Generated post body too short or empty (' + post.body.length + ' chars)');
  }

  const db = await getDb();
  await db.collection('posts').insertOne(post);
  logger.info('Created post ' + post.post_id + ' — "' + post.title.substring(0, 60) + '..." (' + post.body.length + ' chars, ' + post.comments.length + ' comments)');

  return post;
}

/**
 * Regenerate a post by deleting the old draft and creating a new one.
 */
async function regeneratePost(task, persona, oldPostId) {
  const db = await getDb();

  // Delete old draft if exists
  if (oldPostId) {
    await db.collection('posts').deleteOne({ post_id: oldPostId, status: 'draft' });
    logger.info('Deleted old draft ' + oldPostId + ' for regeneration');
  }

  return writePost(task, persona);
}

/**
 * Get posts by status.
 */
async function getPostsByStatus(status, limit) {
  const db = await getDb();
  const posts = await db
    .collection('posts')
    .find({ status: status })
    .sort({ created_at: -1 })
    .limit(limit || 50)
    .toArray();
  return posts;
}

/**
 * Get a post by ID.
 */
async function getPostById(postId) {
  const db = await getDb();
  return db.collection('posts').findOne({ post_id: postId });
}

module.exports = {
  writePost,
  regeneratePost,
  getPostsByStatus,
  getPostById,
};
