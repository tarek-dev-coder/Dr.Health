import { Router } from 'express';
import { logger } from '../lib/logger.js';
import { requireSameOrigin } from '../middleware/sameOrigin.js';
import { generateSuggestions } from '../services/chat.js';

export const suggestionsRouter = Router();

suggestionsRouter.get('/', requireSameOrigin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const suggestions = await generateSuggestions({ requestId: req.id });
    return res.json({ suggestions });
  } catch (error) {
    logger.warn('suggestions_route_failed', {
      requestId: req.id,
      errorName: error?.name,
    });
    return res.json({ suggestions: [] });
  }
});
