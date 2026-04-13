const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { chatJSON } = require('../llm');
const { logger } = require('../../config');

const FITNESS_LEVELS = ['beginner', 'intermediate', 'experienced'];
const GENDERS = ['M', 'F', 'NB'];
const VOICE_TRAIT_POOL = [
  ["uses 'man' and 'bro' a lot", "short sentences"],
  ["self-deprecating humor", "parenthetical asides"],
  ["uses 'honestly' constantly", "long rambling paragraphs"],
  ["dry sarcasm", "British understatement"],
  ["enthusiastic, lots of exclamation marks", "uses emojis sparingly"],
  ["quiet confidence", "rarely uses adverbs"],
  ["stream of consciousness", "forgets to finish sentences"],
  ["analytical, numbers-focused", "avoids emotional language"],
  ["warm and motherly", "uses 'dear' and 'honey'"],
  ["casual profanity", "very direct"],
  ["uses Italian slang even in English", "animated tone"],
  ["minimalist, one-word reactions", "uses '...' a lot"],
  ["over-explains everything", "uses footnotes mentally"],
  ["gym bro energy", "uses 'literally' wrong"],
  ["nerdy references", "capitalizes Random Words"],
  ["gentle and encouraging", "uses 'we' instead of 'I'"],
];

const SUBREDDIT_AFFINITIES = {
  beginner: ['r/loseit', 'r/progresspics'],
  intermediate: ['r/loseit', 'r/fitness', 'r/nutrition'],
  experienced: ['r/fitness', 'r/nutrition'],
};

const PERSONA_SYSTEM_PROMPT = `You generate realistic user personas for a fitness community. Create a believable person with a weight loss journey backstory.

Return a JSON object with this exact structure:
{
  "name": "First name only, realistic for the language",
  "age": number between 20-55,
  "gender": "M" or "F" or "NB",
  "fitness_level": "beginner" or "intermediate" or "experienced",
  "starting_weight_kg": realistic number (65-160),
  "current_weight_kg": must be less than starting weight by 3-25kg,
  "goal_weight_kg": realistic target, less than current weight,
  "height_cm": realistic number (150-200),
  "backstory": "2-3 sentence paragraph about why they started losing weight, their struggles, and motivation. Be specific and human."
}

Rules:
- Weight loss should be 3-25kg, proportional to starting weight
- BMI should be in realistic ranges
- The backstory should feel like a real person, not a character sketch
- Include specific details (doctor visit, wedding, health scare, bet with friend, etc.)`;

async function generatePersona(language, fitnessLevel) {
  const level = fitnessLevel || FITNESS_LEVELS[Math.floor(Math.random() * FITNESS_LEVELS.length)];
  const gender = GENDERS[Math.floor(Math.random() * GENDERS.length)];

  const userMessage = `Generate a persona with these constraints:
- Language/culture: ${language === 'it' ? 'Italian' : 'English/American'}
- Fitness level: ${level}
- Gender: ${gender}
- Age range: ${language === 'it' ? '25-50' : '20-55'}
- Make the backstory specific and human. Include a triggering event.`;

  const personaData = await chatJSON(PERSONA_SYSTEM_PROMPT, userMessage);

  const voiceTraits = VOICE_TRAIT_POOL[Math.floor(Math.random() * VOICE_TRAIT_POOL.length)];
  const affinities = SUBREDDIT_AFFINITIES[level] || SUBREDDIT_AFFINITIES.beginner;
  const affinity = [...affinities];
  if (language === 'it') affinity.push('r/italy');

  const persona = {
    persona_id: uuidv4(),
    name: personaData.name || 'Anonymous',
    age: personaData.age || 30,
    gender: personaData.gender || gender,
    language: language || 'en',
    fitness_level: level,
    starting_weight_kg: parseFloat(personaData.starting_weight_kg) || 90,
    current_weight_kg: parseFloat(personaData.current_weight_kg) || 80,
    goal_weight_kg: parseFloat(personaData.goal_weight_kg) || 75,
    height_cm: parseInt(personaData.height_cm, 10) || 175,
    backstory: personaData.backstory || 'Started losing weight after realizing clothes did not fit anymore.',
    voice_traits: voiceTraits,
    subreddit_affinity: affinity,
    posts_count: 0,
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Validate weight consistency
  if (persona.current_weight_kg >= persona.starting_weight_kg) {
    persona.current_weight_kg = persona.starting_weight_kg - (Math.random() * 12 + 3);
    persona.current_weight_kg = Math.round(persona.current_weight_kg * 10) / 10;
  }
  if (persona.goal_weight_kg >= persona.current_weight_kg) {
    persona.goal_weight_kg = persona.current_weight_kg - (Math.random() * 8 + 2);
    persona.goal_weight_kg = Math.round(persona.goal_weight_kg * 10) / 10;
  }

  const db = await getDb();
  await db.collection('personas').insertOne(persona);
  logger.info(`Created persona: ${persona.name} (${persona.age}${persona.gender}, ${persona.fitness_level}, ${persona.starting_weight_kg}→${persona.current_weight_kg}kg)`);
  return persona;
}

async function getOrCreatePersona(taskParams) {
  const db = await getDb();
  const language = taskParams.language || 'en';
  const subreddit = taskParams.subreddit || 'r/loseit';

  // Try to find an existing persona that matches language and subreddit affinity
  const candidate = await db.collection('personas').findOne({
    active: true,
    language: language,
    subreddit_affinity: subreddit,
    posts_count: { $lt: 5 }, // rotate after 5 posts per persona
  });

  if (candidate) {
    logger.debug(`Reusing persona: ${candidate.name} (${candidate.posts_count} posts)`);
    return candidate;
  }

  // Try broader match — same language, any subreddit
  const broader = await db.collection('personas').findOne({
    active: true,
    language: language,
    posts_count: { $lt: 3 },
  });

  if (broader) {
    logger.debug(`Using broader persona match: ${broader.name}`);
    return broader;
  }

  // Check total active personas — cap at 30
  const activeCount = await db.collection('personas').countDocuments({ active: true });
  if (activeCount >= 30) {
    // Reset the least-used persona
    const leastUsed = await db.collection('personas').findOne(
      { active: true, language: language },
      { sort: { posts_count: 1 } }
    );
    if (leastUsed) {
      logger.debug(`Recycling least-used persona: ${leastUsed.name}`);
      return leastUsed;
    }
  }

  // Generate a new persona
  logger.info(`No matching persona found — generating new one for ${language}/${subreddit}`);
  return generatePersona(language, taskParams.fitness_level);
}

async function incrementPersonaPostCount(personaId) {
  const db = await getDb();
  await db.collection('personas').updateOne(
    { persona_id: personaId },
    { $inc: { posts_count: 1 }, $set: { updated_at: new Date() } }
  );
}

async function getPersonaStats() {
  const db = await getDb();
  const total = await db.collection('personas').countDocuments({ active: true });
  const byLanguage = await db.collection('personas').aggregate([
    { $match: { active: true } },
    { $group: { _id: '$language', count: { $sum: 1 } } },
  ]).toArray();
  const byLevel = await db.collection('personas').aggregate([
    { $match: { active: true } },
    { $group: { _id: '$fitness_level', count: { $sum: 1 } } },
  ]).toArray();

  return {
    total,
    byLanguage: Object.fromEntries(byLanguage.map((r) => [r._id, r.count])),
    byLevel: Object.fromEntries(byLevel.map((r) => [r._id, r.count])),
  };
}

module.exports = {
  generatePersona,
  getOrCreatePersona,
  incrementPersonaPostCount,
  getPersonaStats,
};
