import { Hono } from 'hono';
import { extractLinkedInUsername } from './utils/linkedin';

export interface Env {
  RAPIDAPI_KEY: string;
  LINKEDIN_PROFILES_KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware for logging (optional, but helpful)
app.use('*', async (c, next) => {
  console.log(`[Hono] Request: ${c.req.method} ${c.req.url}`);
  await next();
  console.log(`[Hono] Response: ${c.res.status}`);
});

// API endpoint

app.get('/api/linkedin-profile', async (c) => {
    const fullProfileUrl = c.req.query('linkedinUrl');
    if (!fullProfileUrl) {
      return c.json({ error: 'linkedinUrl query parameter is required' }, 400);
    }
  
    const username = extractLinkedInUsername(fullProfileUrl);
    if (!username) {
      return c.json({ error: 'Could not extract a valid LinkedIn username.' }, 400);
    }
  
    // 1. Try to get data from KV cache first
    try {
      const cachedDataString = await c.env.LINKEDIN_PROFILES_KV.get(username);
      if (cachedDataString) {
        console.log(`[KV] Cache hit for username: ${username}`);
        const cachedData = JSON.parse(cachedDataString);
        return c.json(cachedData); // Return cached data
      }
      console.log(`[KV] Cache miss for username: ${username}`);
    } catch (e) {
      console.error(`[KV] Error reading from KV for username ${username}:`, e);
      // Decide if you want to proceed to API call or return an error. For now, proceed.
    }
  
    // 2. If not in cache, fetch from RapidAPI
    const rapidApiKey = c.env.RAPIDAPI_KEY;
    if (!rapidApiKey) {
      console.error('[Hono] RAPIDAPI_KEY secret is not set.');
      return c.json({ error: 'API key is not configured on the server.' }, 500);
    }
  
    const rapidApiUrl = `https://linkedin-data-api.p.rapidapi.com/?username=${encodeURIComponent(username)}`;
    const rapidApiOptions = { /* ... your headers ... */
      method: 'GET',
      headers: {
        'x-rapidapi-key': rapidApiKey,
        'x-rapidapi-host': 'linkedin-data-api.p.rapidapi.com'
      }
    };
  
    console.log(`[Hono] Calling RapidAPI for username: ${username}`);
    try {
      const rapidApiResponse = await fetch(rapidApiUrl, rapidApiOptions);
      
      // The response you shared is JSON, so let's parse it as JSON
      if (!rapidApiResponse.ok) {
        const errorText = await rapidApiResponse.text();
        console.error(`[Hono] RapidAPI Error (${rapidApiResponse.status}): ${errorText}`);
        return c.json({ error: 'Failed to fetch data from LinkedIn API.', status: rapidApiResponse.status, details: errorText }, 400);
      }
  
      const profileData = await rapidApiResponse.json(); // Assuming RapidAPI sends JSON
      
      console.log('[Hono] Successfully fetched data from RapidAPI.');
  
      // 3. Save the new data to KV
      try {
        // KV values must be strings, ArrayBuffers, or Streams. We'll store the JSON as a string.
        // You can also set an expiration TTL (time-to-live) in seconds if you want the cache to auto-expire.
        // Example: await c.env.LINKEDIN_PROFILES_KV.put(username, JSON.stringify(profileData), { expirationTtl: 3600 }); // Expires in 1 hour
        await c.env.LINKEDIN_PROFILES_KV.put(username, JSON.stringify(profileData));
        console.log(`[KV] Saved data for username: ${username}`);
      } catch (e) {
        console.error(`[KV] Error writing to KV for username ${username}:`, e);
        // Continue to return data even if KV write fails, but log the error
      }

      // Type assertion to ensure profileData is a valid JSON value
      const safeProfileData = profileData as Record<string, unknown>;
      return c.json(safeProfileData); // Return the fresh data with type safety

    } catch (error: unknown) {
      console.error('[Hono] Error calling RapidAPI:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return c.json({ error: 'An error occurred while contacting the external API.', details: errorMessage }, 500);
    }
  });

// Root route (likely served by static index.html first)
app.get('/api/cached-profile', async (c) => {
    const username = c.req.query('username'); // This endpoint will expect a 'username' query param
  
    if (!username) {
      return c.json({ error: 'username query parameter is required' }, 400);
    }
  
    console.log(`[KV Read] Attempting to fetch profile for username: ${username} from KV.`);
  
    try {
      const storedValue = await c.env.LINKEDIN_PROFILES_KV.get(username);
  
      if (storedValue === null) {
        console.log(`[KV Read] No data found in KV for username: ${username}.`);
        return c.json({ error: 'Profile not found in cache for the given username.' }, 404);
      }
  
      console.log(`[KV Read] Data found in KV for username: ${username}.`);
      // The stored value is a string, so parse it back into a JSON object
      const profileData = JSON.parse(storedValue);
      return c.json(profileData);
  
    } catch (error: any) {
      console.error(`[KV Read] Error fetching profile for username ${username} from KV:`, error);
      return c.json({ error: 'Failed to retrieve profile from cache.', details: error.message }, 500);
    }
  });
// Catch-all for 404s
app.notFound((c) => {
  return c.json({ error: 'Not Found', message: `The resource ${c.req.path} was not found.` }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error('[Hono] Uncaught Error:', err);
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;