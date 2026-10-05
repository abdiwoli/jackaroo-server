import { createRequestHandler } from './app.js';

// One handler/store per function instance; no listening socket at import time.
export default createRequestHandler();
