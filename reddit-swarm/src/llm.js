const OpenAI = require('openai');
const { config, logger } = require('../config');

let client = null;

function getClient() {
  if (client) return client;
  client = new OpenAI({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseURL,
  });
  return client;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chat(systemPrompt, userMessage) {
  const openai = getClient();
  let lastError = null;

  for (let attempt = 1; attempt <= config.llm.maxRetries; attempt++) {
    try {
      logger.debug(`LLM call attempt ${attempt}/${config.llm.maxRetries}`);
      const response = await openai.chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      });

      const text = response.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('Empty response from LLM');
      }
      logger.debug(`LLM response: ${text.substring(0, 100)}...`);
      return text;
    } catch (err) {
      lastError = err;
      const backoff = config.llm.retryBaseDelay * Math.pow(2, attempt - 1);
      logger.warn(`LLM call failed (attempt ${attempt}): ${err.message}. Retrying in ${backoff}ms...`);
      if (attempt < config.llm.maxRetries) {
        await delay(backoff);
      }
    }
  }

  throw new Error(`LLM call failed after ${config.llm.maxRetries} attempts: ${lastError?.message}`);
}

async function chatJSON(systemPrompt, userMessage) {
  const text = await chat(systemPrompt, userMessage);

  // Try to extract JSON from markdown code blocks first
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch (_) {
      // fall through
    }
  }

  // Try to find JSON object or array in the response
  const jsonMatch = text.match(/[\[{][\s\S]*[\]}]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_) {
      // fall through
    }
  }

  // Last resort: parse the whole thing
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse LLM response as JSON: ${err.message}. Response: ${text.substring(0, 200)}`);
  }
}

module.exports = { chat, chatJSON };
