/**
 * Intent Parser Module
 *
 * Converts unstructured natural language input from the user into a
 * strictly typed RiskProfile. The actual LLM call is delegated to an
 * injected IntentParserAdapter (Dependency Injection), allowing:
 *
 * - Swapping LLM providers without changing this module
 * - Unit testing with mock adapters
 * - Rate limiting and caching at the adapter level
 *
 * This module provides the default adapter implementation that formats
 * the LLM prompt, as well as validation logic for parsed results.
 */

import type {
  IntentParserAdapter,
  ParsedIntent,
  RiskLevel,
  RiskProfile,
  TimeHorizon,
} from '../types/profile.js';

/** Minimum confidence threshold below which we ask the user to clarify */
const MIN_CONFIDENCE_THRESHOLD = 0.6;

/** Valid risk levels for runtime validation */
const VALID_RISK_LEVELS: readonly RiskLevel[] = [
  'conservative',
  'moderate',
  'aggressive',
];

/** Valid time horizons for runtime validation */
const VALID_TIME_HORIZONS: readonly TimeHorizon[] = [
  'short',
  'medium',
  'long',
];

/**
 * System prompt template for the LLM.
 * Instructs the model to extract financial intent from user messages.
 */
export const INTENT_EXTRACTION_PROMPT = `You are a financial intent extraction engine for TradeMind, a DeFi assistant on the TON blockchain.

Your task: analyze the user's message and extract their investment profile as a JSON object.

Output ONLY valid JSON with this exact structure:
{
  "riskLevel": "conservative" | "moderate" | "aggressive",
  "timeHorizon": "short" | "medium" | "long",
  "preferredAssets": ["TON", "USDT", ...],
  "maxDrawdown": 0.0 to 1.0,
  "confidence": 0.0 to 1.0
}

Rules:
- "short" = less than 3 months, "medium" = 3-12 months, "long" = over 1 year
- "conservative" maxDrawdown typically 0.05-0.10
- "moderate" maxDrawdown typically 0.10-0.25
- "aggressive" maxDrawdown typically 0.25-0.50
- If the user mentions specific tokens, include them in preferredAssets
- If info is ambiguous, set confidence lower and use reasonable defaults
- NEVER output anything except the JSON object`;

/**
 * Validates a raw LLM response and converts it into a ParsedIntent.
 *
 * @param rawJson - The JSON string returned by the LLM
 * @param rawInput - The original user message
 * @returns A validated ParsedIntent
 *
 * @throws Error if the LLM response is malformed or contains invalid values
 */
export function validateLlmResponse(
  rawJson: string,
  rawInput: string,
): ParsedIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error(
      'LLM returned invalid JSON for intent extraction. ' +
      `Raw response: "${rawJson.substring(0, 200)}"`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('LLM response is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate riskLevel
  const riskLevel = obj['riskLevel'];
  if (!isValidRiskLevel(riskLevel)) {
    throw new Error(
      `Invalid riskLevel: "${String(riskLevel)}". ` +
      `Must be one of: ${VALID_RISK_LEVELS.join(', ')}`,
    );
  }

  // Validate timeHorizon
  const timeHorizon = obj['timeHorizon'];
  if (!isValidTimeHorizon(timeHorizon)) {
    throw new Error(
      `Invalid timeHorizon: "${String(timeHorizon)}". ` +
      `Must be one of: ${VALID_TIME_HORIZONS.join(', ')}`,
    );
  }

  // Validate preferredAssets
  const preferredAssets = obj['preferredAssets'];
  if (!Array.isArray(preferredAssets) || !preferredAssets.every(isString)) {
    throw new Error('preferredAssets must be an array of strings');
  }

  // Validate maxDrawdown
  const maxDrawdown = obj['maxDrawdown'];
  if (typeof maxDrawdown !== 'number' || maxDrawdown < 0 || maxDrawdown > 1) {
    throw new Error(
      `Invalid maxDrawdown: ${String(maxDrawdown)}. Must be a number between 0 and 1`,
    );
  }

  // Validate confidence
  const confidence = obj['confidence'];
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error(
      `Invalid confidence: ${String(confidence)}. Must be a number between 0 and 1`,
    );
  }

  return {
    riskProfile: {
      riskLevel,
      timeHorizon,
      preferredAssets: Object.freeze([...preferredAssets]),
      maxDrawdown,
    },
    rawInput,
    confidence,
  };
}

/**
 * Checks if the parsed intent has sufficient confidence.
 * If below threshold, the caller should ask the user for clarification.
 */
export function needsClarification(intent: ParsedIntent): boolean {
  return intent.confidence < MIN_CONFIDENCE_THRESHOLD;
}

/**
 * Returns a follow-up question to ask the user when confidence is low.
 */
export function buildClarificationPrompt(intent: ParsedIntent): string {
  const weakPoints: string[] = [];

  if (intent.riskProfile.preferredAssets.length === 0) {
    weakPoints.push(
      'какие токены вас интересуют (например, TON, USDT, jUSDT)',
    );
  }

  if (intent.confidence < 0.4) {
    weakPoints.push('ваш допустимый уровень риска');
    weakPoints.push('на какой срок вы планируете инвестировать');
  }

  if (weakPoints.length === 0) {
    return 'Уточните, пожалуйста, ваши инвестиционные предпочтения подробнее.';
  }

  return `Для более точного анализа, расскажите: ${weakPoints.join('; ')}.`;
}

/**
 * Default implementation of IntentParserAdapter.
 *
 * Accepts a generic LLM call function, allowing integration with any provider
 * (Anthropic Claude, OpenAI, local models, etc.) without hard-coding dependencies.
 */
export function createIntentParserAdapter(
  llmCall: (systemPrompt: string, userMessage: string) => Promise<string>,
): IntentParserAdapter {
  return {
    async parseUserIntent(userMessage: string): Promise<ParsedIntent> {
      if (userMessage.trim().length === 0) {
        throw new Error('Cannot parse empty user message');
      }

      const rawResponse = await llmCall(
        INTENT_EXTRACTION_PROMPT,
        userMessage,
      );

      return validateLlmResponse(rawResponse, userMessage);
    },
  };
}

// ─── Type Guards ─────────────────────────────────────────────

function isValidRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && VALID_RISK_LEVELS.includes(value as RiskLevel);
}

function isValidTimeHorizon(value: unknown): value is TimeHorizon {
  return typeof value === 'string' && VALID_TIME_HORIZONS.includes(value as TimeHorizon);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
