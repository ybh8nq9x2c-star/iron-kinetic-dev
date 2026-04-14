"""
Iron Kinetic Reddit Swarm - LLM Client
OpenAI-compatible client for z.ai with retry logic.
"""

import json
import time
from typing import Optional

from openai import OpenAI, APIError, RateLimitError, APITimeoutError

from src.config import Config, log


def _create_client() -> OpenAI:
    """Create an OpenAI-compatible client configured for z.ai."""
    return OpenAI(
        api_key=Config.ZAI_API_KEY,
        base_url=Config.ZAI_BASE_URL,
        timeout=60.0,
        max_retries=0,  # we handle retries ourselves
    )


_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    """Get or create the LLM client singleton."""
    global _client
    if _client is None:
        _client = _create_client()
        log.info("LLM client initialized: base_url=%s model=%s", Config.ZAI_BASE_URL, Config.ZAI_MODEL)
    return _client


def chat(system_prompt: str, user_message: str) -> str:
    """
    Send a chat completion request and return the assistant message text.
    Retries up to LLM_MAX_RETRIES times with exponential backoff.

    Args:
        system_prompt: System-level instructions.
        user_message: User message content.

    Returns:
        The assistant's response text.

    Raises:
        RuntimeError: If all retries are exhausted.
    """
    client = _get_client()
    last_error = None

    for attempt in range(1, Config.LLM_MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=Config.ZAI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.8,
                max_tokens=1500,
            )
            content = response.choices[0].message.content
            if content is None:
                raise ValueError("LLM returned empty content")
            log.debug("LLM chat success (attempt %d): %d chars", attempt, len(content))
            return content.strip()

        except RateLimitError as e:
            last_error = e
            wait = Config.LLM_RETRY_BASE_DELAY * (2 ** attempt)
            log.warning("Rate limited on attempt %d, waiting %.1fs: %s", attempt, wait, e)
            time.sleep(wait)

        except (APIError, APITimeoutError) as e:
            last_error = e
            wait = Config.LLM_RETRY_BASE_DELAY * (2 ** attempt)
            log.warning("API error on attempt %d, waiting %.1fs: %s", attempt, wait, e)
            time.sleep(wait)

        except Exception as e:
            last_error = e
            log.error("Unexpected error on attempt %d: %s", attempt, e)
            break

    raise RuntimeError(f"LLM chat failed after {Config.LLM_MAX_RETRIES} attempts: {last_error}")


def chat_json(system_prompt: str, user_message: str) -> dict:
    """
    Send a chat completion request and parse the response as JSON.
    Tries to extract JSON from markdown code blocks if present.

    Args:
        system_prompt: System-level instructions.
        user_message: User message content.

    Returns:
        Parsed dictionary from the LLM response.

    Raises:
        RuntimeError: If all retries are exhausted or JSON parsing fails.
    """
    raw = chat(system_prompt, user_message)

    # Try direct JSON parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    import re
    json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", raw, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try finding first { to last }
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        try:
            return json.loads(raw[first_brace:last_brace + 1])
        except json.JSONDecodeError:
            pass

    raise RuntimeError(f"Failed to parse LLM response as JSON: {raw[:200]}")
