import { Hono } from 'hono';
import { extractLinkedInUsername } from './utils/linkedin';

export interface Env {
  RAPIDAPI_KEY: string;
  LINKEDIN_PROFILES_KV: KVNamespace;
  ANTHROPIC_API_KEY: string;
}

interface ClaudeContent {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: any;
}

interface ClaudeResponse {
  content: ClaudeContent[];
}

const app = new Hono<{ Bindings: Env }>();

// Middleware for logging (optional, but helpful)
app.use('*', async (c, next) => {
  console.log(`[Hono] Request: ${c.req.method} ${c.req.url}`);
  await next();
  console.log(`[Hono] Response: ${c.res.status}`);
});

// LinkedIn scraping function that can be used as a tool
async function scrapeLinkedInProfile(linkedinUrl: string, env: Env) {
  console.log(`[LinkedIn] Starting scrape for URL: ${linkedinUrl}`);
  
  const username = extractLinkedInUsername(linkedinUrl);
  if (!username) {
    console.error(`[LinkedIn] Failed to extract username from URL: ${linkedinUrl}`);
    throw new Error('Could not extract a valid LinkedIn username.');
  }
  
  console.log(`[LinkedIn] Extracted username: ${username}`);

  // Try cache first
  try {
    console.log(`[KV] Checking cache for username: ${username}`);
    const cachedDataString = await env.LINKEDIN_PROFILES_KV.get(username);
    if (cachedDataString) {
      console.log(`[KV] ✅ Cache HIT for username: ${username}`);
      console.log(`[KV] Cached data length: ${cachedDataString.length} characters`);
      const cachedData = JSON.parse(cachedDataString);
      return cachedData;
    } else {
      console.log(`[KV] ❌ Cache MISS for username: ${username}`);
    }
  } catch (e) {
    console.error(`[KV] Error reading from KV for username ${username}:`, e);
  }

  // Fetch from RapidAPI
  const rapidApiKey = env.RAPIDAPI_KEY;
  if (!rapidApiKey) {
    console.error('[RapidAPI] RAPIDAPI_KEY secret is not set.');
    throw new Error('API key is not configured on the server.');
  }

  const rapidApiUrl = `https://linkedin-data-api.p.rapidapi.com/?username=${encodeURIComponent(username)}`;
  const rapidApiOptions = {
    method: 'GET',
    headers: {
      'x-rapidapi-key': rapidApiKey,
      'x-rapidapi-host': 'linkedin-data-api.p.rapidapi.com'
    }
  };

  console.log(`[RapidAPI] 🌐 Calling API for username: ${username}`);
  console.log(`[RapidAPI] URL: ${rapidApiUrl}`);
  
  const rapidApiResponse = await fetch(rapidApiUrl, rapidApiOptions);
  
  if (!rapidApiResponse.ok) {
    const errorText = await rapidApiResponse.text();
    console.error(`[RapidAPI] Error (${rapidApiResponse.status}): ${errorText}`);
    throw new Error(`Failed to fetch data from LinkedIn API: ${errorText}`);
  }

  const profileData = await rapidApiResponse.json();
  console.log(`[RapidAPI] ✅ Successfully fetched data for username: ${username}`);
  console.log(`[RapidAPI] Response data type: ${typeof profileData}`);

  // Save to cache
  try {
    const dataToCache = JSON.stringify(profileData);
    console.log(`[KV] 💾 Saving to cache - username: ${username}, data length: ${dataToCache.length} characters`);
    
    await env.LINKEDIN_PROFILES_KV.put(username, dataToCache);
    console.log(`[KV] ✅ Successfully saved data for username: ${username}`);
    
    // Verify the save by immediately reading it back
    const verifyRead = await env.LINKEDIN_PROFILES_KV.get(username);
    if (verifyRead) {
      console.log(`[KV] ✅ Verification: Data successfully stored and readable for username: ${username}`);
    } else {
      console.error(`[KV] ❌ Verification failed: Could not read back stored data for username: ${username}`);
    }
  } catch (e) {
    console.error(`[KV] Error writing to KV for username ${username}:`, e);
  }

  return profileData;
}

// New chat endpoint
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json();
    
    if (!message) {
      return c.json({ error: 'Message is required' }, 400);
    }

    const anthropicApiKey = c.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return c.json({ error: 'Anthropic API key is not configured' }, 500);
    }

    // Define the tool for Claude
    const tools = [
      {
        name: "scrape_linkedin_profile",
        description: "Scrape a LinkedIn profile to get detailed information about a person's professional background, experience, education, and skills.",
        input_schema: {
          type: "object",
          properties: {
            linkedin_url: {
              type: "string",
              description: "The LinkedIn profile URL to scrape (e.g., https://linkedin.com/in/username)"
            }
          },
          required: ["linkedin_url"]
        }
      }
    ];

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        tools: tools,
        messages: [
          {
            role: 'user',
            content: message
          }
        ]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API Error:', errorText);
      return c.json({ error: 'Failed to get response from Claude API' }, 500);
    }

    const claudeData = await claudeResponse.json() as ClaudeResponse;
    
    // Check if Claude wants to use tools
    if (claudeData.content && claudeData.content.some((block: ClaudeContent) => block.type === 'tool_use')) {
      const toolUse = claudeData.content.find((block: ClaudeContent) => block.type === 'tool_use');
      
      if (toolUse && toolUse.name === 'scrape_linkedin_profile') {
        try {
          // Execute the LinkedIn scraping
          const profileData = await scrapeLinkedInProfile(toolUse.input.linkedin_url, c.env);
          
          // Send tool result back to Claude for a final response
          const finalResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': anthropicApiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-3-sonnet-20240229',
              max_tokens: 4000,
              messages: [
                {
                  role: 'user',
                  content: message
                },
                {
                  role: 'assistant',
                  content: claudeData.content
                },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: JSON.stringify(profileData)
                    }
                  ]
                }
              ]
            })
          });

          if (finalResponse.ok) {
            const finalData = await finalResponse.json() as ClaudeResponse;
            return c.json({
              response: finalData.content[0]?.text || 'Successfully scraped the LinkedIn profile!',
              profile_data: profileData,
              tool_used: true
            });
          }
        } catch (error) {
          console.error('Tool execution error:', error);
          return c.json({
            response: `I tried to scrape that LinkedIn profile, but encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            tool_used: true,
            error: true
          });
        }
      }
    }

    // Return Claude's regular response
    return c.json({
      response: claudeData.content[0]?.text || 'I received your message but had trouble generating a response.',
      tool_used: false
    });

  } catch (error) {
    console.error('Chat API Error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Debug endpoint to list cache entries
app.get('/api/debug/cache', async (c) => {
  try {
    // KV doesn't have a "list all" operation easily available in the free tier
    // But we can provide useful debug info
    return c.json({
      message: 'Cache debug endpoint',
      kv_namespace: 'LINKEDIN_PROFILES_KV',
      note: 'Use /api/debug?url=<linkedin_url> to check specific URL cache status',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return c.json({
      error: 'Failed to access cache debug info',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Debug endpoint to check cache and URL extraction
app.get('/api/debug', async (c) => {
  const url = c.req.query('url');
  
  if (!url) {
    return c.json({ 
      error: 'Please provide a URL parameter: /api/debug?url=https://linkedin.com/in/example',
      example: '/api/debug?url=https://linkedin.com/in/example'
    }, 400);
  }

  console.log(`[Debug] Testing URL: ${url}`);
  
  const username = extractLinkedInUsername(url);
  console.log(`[Debug] Extracted username: ${username}`);
  
  if (!username) {
    return c.json({
      url: url,
      username: null,
      error: 'Could not extract username from URL',
      cache_status: 'N/A'
    });
  }

  // Check cache status
  try {
    const cachedData = await c.env.LINKEDIN_PROFILES_KV.get(username);
    const cacheStatus = cachedData ? 'HIT' : 'MISS';
    const cacheDataLength = cachedData ? cachedData.length : 0;
    
    console.log(`[Debug] Cache status for ${username}: ${cacheStatus}`);
    
    return c.json({
      url: url,
      username: username,
      cache_status: cacheStatus,
      cache_data_length: cacheDataLength,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[Debug] Error checking cache for ${username}:`, error);
    return c.json({
      url: url,
      username: username,
      cache_status: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Existing API endpoints (keep as they are for backward compatibility)
app.get('/api/linkedin-profile', async (c) => {
    const fullProfileUrl = c.req.query('linkedinUrl');
    if (!fullProfileUrl) {
      return c.json({ error: 'linkedinUrl query parameter is required' }, 400);
    }
  
    try {
      const profileData = await scrapeLinkedInProfile(fullProfileUrl, c.env);
      return c.json(profileData);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return c.json({ error: errorMessage }, 400);
    }
});

app.get('/api/cached-profile', async (c) => {
    const username = c.req.query('username');
  
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