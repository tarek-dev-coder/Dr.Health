import express from 'express';
import { createApp } from './server/app.js';

// Vercel detects this root-level Express entrypoint automatically. Keep the
// direct express import for the framework detector; the actual app is built by
// createApp. Local development and Render continue to use server/index.js,
// which also starts the HTTP listener and handles graceful shutdown.
const app = createApp();
app.locals.express = express;

export default app;
