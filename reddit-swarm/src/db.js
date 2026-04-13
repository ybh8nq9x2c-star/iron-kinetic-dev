const { MongoClient } = require('mongodb');
const { config, logger } = require('../config');

let client = null;
let db = null;

async function getDb() {
  if (db) return db;

  try {
    client = new MongoClient(config.mongodb.uri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    });

    await client.connect();
    db = client.db();
    logger.info('Connected to MongoDB:', db.databaseName);
    return db;
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    throw err;
  }
}

async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}

async function createIndexes() {
  const database = await getDb();
  logger.info('Creating MongoDB indexes...');

  await database.collection('post_queue').createIndex({ status: 1, priority: -1, scheduled_for: 1 });
  await database.collection('post_queue').createIndex({ status: 1 });
  await database.collection('posts').createIndex({ status: 1 });
  await database.collection('posts').createIndex({ task_id: 1 });
  await database.collection('posts').createIndex({ persona_id: 1 });
  await database.collection('personas').createIndex({ active: 1 });
  await database.collection('personas').createIndex({ persona_id: 1 });
  await database.collection('metrics').createIndex({ date: 1 }, { unique: true });

  logger.info('All indexes created');
}

module.exports = { getDb, closeDb, createIndexes };
