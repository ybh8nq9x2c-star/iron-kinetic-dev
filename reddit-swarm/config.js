require('dotenv').config();

const config = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/reddit_swarm',
    dbName: new URL(process.env.MONGODB_URI || 'mongodb://localhost:27017/reddit_swarm').pathname.replace(/^\//, '') || 'reddit_swarm',
  },
  llm: {
    apiKey: process.env.ZAI_API_KEY,
    baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/v1',
    model: process.env.ZAI_MODEL || 'GLM-5.1',
    maxRetries: 3,
    retryBaseDelay: 1000,
  },
  pipeline: {
    postsPerDay: parseInt(process.env.POSTS_PER_DAY || '14', 10),
    qualityThreshold: parseFloat(process.env.QUALITY_THRESHOLD || '0.7'),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[config.logging.level] || LOG_LEVELS.info;

function ts() {
  return new Date().toISOString();
}

const logger = {
  debug: (...args) => currentLevel <= LOG_LEVELS.debug && console.log(`[${ts()}] [DEBUG]`, ...args),
  info: (...args) => currentLevel <= LOG_LEVELS.info && console.log(`[${ts()}] [INFO]`, ...args),
  warn: (...args) => currentLevel <= LOG_LEVELS.warn && console.warn(`[${ts()}] [WARN]`, ...args),
  error: (...args) => currentLevel <= LOG_LEVELS.error && console.error(`[${ts()}] [ERROR]`, ...args),
};

module.exports = { config, logger };
