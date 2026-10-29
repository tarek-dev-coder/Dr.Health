import express from 'express';
import { createApp } from '../server/app.js';

const app = createApp();

// Vercel's zero-config Express detection reads this entrypoint.
void express;

export default app;
